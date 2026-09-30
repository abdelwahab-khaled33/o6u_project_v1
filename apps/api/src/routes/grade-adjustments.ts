import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { isDoctorOfSubject } from '../services/subject-access.js';
import { applyGradeCompensation } from '../services/grade-adjustment.js';
import { ADJUSTMENT_TYPES } from '@exam/shared';

/**
 * GradeAdjustment.new_points / previous_points and StudentExamQuestion.grade_awarded are
 * `Decimal(6,2)` in the schema, so anything above 9999.99 cannot be stored at all and
 * anything with a third decimal place is silently rounded. A bound in Zod is not a
 * nicety here: without it the first case reached Prisma and answered 500, and the
 * second wrote an audit row disagreeing with the points the actor actually asked for.
 *
 * This is only the storage ceiling. Whether an examiner may award more than the exam's
 * own points_per_question is a policy question the spec does not settle, so it is
 * deliberately not enforced here.
 */
const MAX_ADJUSTMENT_POINTS = 9999.99;

/**
 * Whether `value` survives being written to a `Decimal(6,2)` column unchanged.
 *
 * This must be decimal arithmetic, not `Number.isInteger(value * 100)`. A JS
 * number is binary, so 0.29 is really 0.289999999999999980015985556747182272374629974365234375 and
 * `0.29 * 100` is 28.999999999999996. Enumerated over every two-decimal value in
 * [0.01, 9999.99], that check refuses 131,256 of 1,000,000 -- 13.13% -- starting at
 * 0.07, 0.14, 0.28, 0.29. It was proven against the running server, not inferred:
 * on otherwise byte-identical bodies, `points: 0.07` and `0.29` answered 400 while
 * `0.08` and `0.25` answered 200.
 *
 * `new Prisma.Decimal(n)` reads the number through its shortest round-trip decimal
 * form, so 0.29 becomes exactly 0.29 and the multiply is exact. It is also the same
 * arithmetic the column stores with, which is why this accepts precisely the values
 * Postgres would keep and still refuses 1.005 and 0.294.
 */
export function hasAtMostTwoDecimals(value: number): boolean {
  return new Prisma.Decimal(value).mul(100).isInteger();
}

const CompensateExamSchema = z.object({
  source_question_id: z.string().uuid(),
  adjustment_type: z.enum(ADJUSTMENT_TYPES),
  points: z
    .number()
    .nonnegative()
    .max(MAX_ADJUSTMENT_POINTS, `points must not exceed ${MAX_ADJUSTMENT_POINTS}`)
    .refine(hasAtMostTwoDecimals, {
      message: 'points must have at most 2 decimal places',
    })
    .optional(),
  student_exam_ids: z.array(z.string().uuid()).optional(),
  reason: z.string().trim().min(3, 'Reason for grade adjustment is required'),
});

/** The shape both routes need before they may decide anything about the exam. */
type AdjustmentExam = {
  id: string;
  type: string;
  owner_id: string;
  subject_id: string;
  status?: string;
};

/**
 * Authorization, not validation. Returns a rejection to send back, or null to proceed.
 *
 * Both routes call this before looking at the exam's status, and it is shared so the two
 * cannot drift: the POST route used to run its 409 "only approved exams" gate first,
 * which told any doctor who guessed an exam id whether that exam existed and what state
 * it was in, while the GET sibling on the same exam answered 403.
 */
async function authorizeExamAccess(
  exam: AdjustmentExam,
  role: string,
  userId: string,
): Promise<{ status: number; error: string } | null> {
  if (role !== 'doctor') return null;

  if (exam.type === 'doctor_exam') {
    if (exam.owner_id !== userId) return { status: 403, error: 'You do not own this exam' };
    return null;
  }
  if (exam.type === 'ta_quiz') {
    const owns = await isDoctorOfSubject(userId, exam.subject_id);
    if (!owns) return { status: 403, error: 'You are not the doctor of this subject' };
    return null;
  }
  return { status: 403, error: 'Forbidden' };
}

export const gradeAdjustmentsRouter = Router();
gradeAdjustmentsRouter.use(requireAuth);

gradeAdjustmentsRouter.post(
  '/exams/:examId/compensate',
  requireRoles('admin', 'doctor'),
  requirePermission('grades.adjust'),
  requireUuidParam('examId', 'Exam not found'),
  async (req, res, next) => {
    try {
      const parsed = CompensateExamSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const data = parsed.data;

      if (data.adjustment_type === 'set_points' && data.points == null) {
        return res
          .status(400)
          .json({ error: 'points is required for set_points adjustment' });
      }

      const exam = await prisma.exam.findUnique({
        where: { id: req.params.examId as string },
        select: { id: true, type: true, owner_id: true, subject_id: true, status: true },
      });
      if (!exam) return res.status(404).json({ error: 'Exam not found' });

      const role = req.auth!.role;
      const userId = req.auth!.userId;

      // Authorization first, then state. A doctor with no claim on this exam must not
      // learn from the answer whether it exists or what stage it is at.
      const denied = await authorizeExamAccess(exam, role, userId);
      if (denied) return res.status(denied.status).json({ error: denied.error });

      if (exam.status !== 'approved') {
        return res.status(409).json({ error: 'Only approved exams can receive grade adjustments' });
      }

      const result = await applyGradeCompensation({
        sourceQuestionId: data.source_question_id,
        examId: exam.id,
        adjustmentType: data.adjustment_type,
        points: data.points,
        studentExamIds: data.student_exam_ids,
        reason: data.reason,
        actorId: userId,
      });

      res.status(200).json({
        message: 'Grade compensation applied',
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },
);

gradeAdjustmentsRouter.get(
  '/exams/:examId/adjustments',
  requireRoles('admin', 'doctor'),
  requirePermission('grades.adjust'),
  requireUuidParam('examId', 'Exam not found'),
  async (req, res, next) => {
    try {
      const exam = await prisma.exam.findUnique({
        where: { id: req.params.examId as string },
        select: { id: true, type: true, owner_id: true, subject_id: true },
      });
      if (!exam) return res.status(404).json({ error: 'Exam not found' });

      const denied = await authorizeExamAccess(exam, req.auth!.role, req.auth!.userId);
      if (denied) return res.status(denied.status).json({ error: denied.error });

      const adjustments = await prisma.gradeAdjustment.findMany({
        where: {
          student_exam_question: {
            student_exam: { exam_id: exam.id },
          },
        },
        include: {
          student_exam_question: {
            select: {
              id: true,
              question_id: true,
              text: true,
              student_exam: {
                select: {
                  id: true,
                  student: { select: { id: true, full_name: true, student_code: true } },
                },
              },
            },
          },
          actor: { select: { id: true, full_name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      res.json({ adjustments });
    } catch (err) {
      next(err);
    }
  },
);
