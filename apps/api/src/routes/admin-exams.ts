import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { checkPoolSufficiency, generateStudentExamsForExam } from '../services/exam-sampling.js';
import { autoSubmitExpiredExams } from '../services/exam-grading.js';
import { createAccessCodeData } from '../services/access-code.js';
import { EXAM_DETAIL_SELECT, EXAM_LIST_SELECT } from '../services/exam-selects.js';

export const adminExamsRouter = Router();
adminExamsRouter.use(requireAuth, requireRoles('admin'));

const EXAM_STATUSES = ['pending_approval', 'approved', 'rejected'] as const;

export const adminExamListQuerySchema = z.object({
  // The literal('') is load-bearing: the exams screen's "All statuses" option has an
  // empty option value, so the front end really does send ?status=. Without it a plain
  // z.enum(...).optional() would answer 400 to a legitimate request. Anything else that
  // is not a real status is rejected rather than treated as "no filter", because
  // silently widening an approval screen's result set is how the wrong exam gets approved.
  status: z.union([z.enum(EXAM_STATUSES), z.literal('')]).optional(),
});

adminExamsRouter.get('/exams', requirePermission('exams.approve'), async (req, res, next) => {
  try {
    const parsed = adminExamListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exam filter' });
    }
    const { status } = parsed.data;
    const exams = await prisma.exam.findMany({
      where: status ? { status } : undefined,
      select: EXAM_LIST_SELECT,
      orderBy: { created_at: 'desc' },
    });
    res.json({ exams });
  } catch (err) {
    next(err);
  }
});

adminExamsRouter.post(
  '/exams/:id/approve',
  requirePermission('exams.approve'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { pool_questions: { include: { question: { select: { difficulty: true, is_archived: true } } } } },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'pending_approval') {
      return res.status(409).json({ error: 'Only pending_approval exams can be approved' });
    }
    if (new Date() >= exam.end_time) {
      return res.status(409).json({ error: 'Exam has already ended and can only be deleted' });
    }

    const activeQuestions = exam.pool_questions
      .filter((p) => !p.question.is_archived)
      .map((p) => p.question);
    const sufficiency = checkPoolSufficiency(
      activeQuestions,
      exam.difficulty_mix as { easy: number; medium: number; hard: number },
    );
    if (!sufficiency.ok) {
      return res.status(409).json({ error: sufficiency.error });
    }

    const updated = await prisma.$transaction(
      async (tx) => {
        const accessCodeData = createAccessCodeData();
        const approved = await tx.exam.update({
          where: { id: exam.id },
          data: {
            status: 'approved',
            approved_by: req.auth!.userId,
            approved_at: new Date(),
            access_code_hash: accessCodeData.access_code_hash,
            access_code_encrypted: accessCodeData.access_code_encrypted,
            access_code_expires_at: exam.end_time,
          },
          select: EXAM_DETAIL_SELECT,
        });
        await generateStudentExamsForExam(tx, exam.id);
        return approved;
      },
      { timeout: 60000 },
    );

    res.json({ exam: updated });
  } catch (err) {
    next(err);
  }
});

const regenerateAccessCodeSchema = z.object({
  access_code_expires_at: z.string().datetime().optional(),
});

adminExamsRouter.post(
  '/exams/:id/access-code/regenerate',
  requirePermission('exams.access_code.regenerate'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const parsed = regenerateAccessCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid access-code payload' });

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'approved') {
      return res.status(409).json({ error: 'Only approved exams can have an access code regenerated' });
    }

    const accessCodeData = createAccessCodeData();
    const expiresAt = parsed.data.access_code_expires_at
      ? new Date(parsed.data.access_code_expires_at)
      : exam.access_code_expires_at ?? exam.end_time;
    const updated = await prisma.exam.update({
      where: { id: exam.id },
      data: {
        access_code_hash: accessCodeData.access_code_hash,
        access_code_encrypted: accessCodeData.access_code_encrypted,
        access_code_expires_at: expiresAt,
      },
      select: EXAM_DETAIL_SELECT,
    });

    res.json({ exam: updated, access_code: accessCodeData.code });
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required'),
});

adminExamsRouter.post(
  '/exams/:id/reject',
  requirePermission('exams.approve'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A rejection reason is required (min 3 characters)' });
    }

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'pending_approval') {
      return res.status(409).json({ error: 'Only pending_approval exams can be rejected' });
    }

    const updated = await prisma.exam.update({
      where: { id: exam.id },
      data: { status: 'rejected', rejection_reason: parsed.data.reason },
      select: EXAM_DETAIL_SELECT,
    });
    res.json({ exam: updated });
  } catch (err) {
    next(err);
  }
});

adminExamsRouter.post('/exams/auto-submit-sweep', requirePermission('exams.approve'), async (_req, res, next) => {
  try {
    const result = await autoSubmitExpiredExams();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
