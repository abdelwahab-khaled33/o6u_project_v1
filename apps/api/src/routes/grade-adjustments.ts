import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { isDoctorOfSubject } from '../services/subject-access.js';
import { applyGradeCompensation } from '../services/grade-adjustment.js';
import { ADJUSTMENT_TYPES } from '@exam/shared';

const CompensateExamSchema = z.object({
  source_question_id: z.string().uuid(),
  adjustment_type: z.enum(ADJUSTMENT_TYPES),
  points: z.number().nonnegative().optional(),
  student_exam_ids: z.array(z.string().uuid()).optional(),
  reason: z.string().trim().min(3, 'Reason for grade adjustment is required'),
});

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
      if (exam.status !== 'approved') {
        return res.status(409).json({ error: 'Only approved exams can receive grade adjustments' });
      }

      const role = req.auth!.role;
      const userId = req.auth!.userId;

      if (role === 'doctor') {
        if (exam.type === 'doctor_exam') {
          if (exam.owner_id !== userId) {
            return res.status(403).json({ error: 'You do not own this exam' });
          }
        } else if (exam.type === 'ta_quiz') {
          const owns = await isDoctorOfSubject(userId, exam.subject_id);
          if (!owns) {
            return res.status(403).json({ error: 'You are not the doctor of this subject' });
          }
        } else {
          return res.status(403).json({ error: 'Forbidden' });
        }
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

      const role = req.auth!.role;
      const userId = req.auth!.userId;

      if (role === 'doctor') {
        if (exam.type === 'doctor_exam') {
          if (exam.owner_id !== userId) {
            return res.status(403).json({ error: 'You do not own this exam' });
          }
        } else if (exam.type === 'ta_quiz') {
          const owns = await isDoctorOfSubject(userId, exam.subject_id);
          if (!owns) {
            return res.status(403).json({ error: 'You are not the doctor of this subject' });
          }
        } else {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

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
