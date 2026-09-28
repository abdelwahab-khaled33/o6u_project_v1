import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isUuid, requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { isDoctorOfSubject } from '../services/subject-access.js';
import {
  buildCombinedResultsData,
  checkExamResultAccess,
  computeExamMaxGrade,
  getExamResultRows,
} from '../services/results.js';
import { buildAllScopeWorkbook, buildSingleScopeWorkbook, sendWorkbook } from '../services/results-export.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

resultsRouter.get('/exams/:examId', requireRoles('admin', 'doctor', 'ta'), requirePermission('results.view'), requireUuidParam('examId', 'Exam not found'), async (req, res, next) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.examId as string },
      include: {
        subject: { select: { id: true, code: true, name: true } },
        owner: { select: { id: true, full_name: true } },
      },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const access = await checkExamResultAccess(req.auth!, exam);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const rows = await getExamResultRows(exam);

    res.json({
      exam: {
        id: exam.id,
        type: exam.type,
        title: exam.title,
        subject: exam.subject,
        start_time: exam.start_time,
        end_time: exam.end_time,
        points_per_question: exam.points_per_question,
        max_grade: computeExamMaxGrade(exam),
        owner: { id: exam.owner.id, full_name: exam.owner.full_name },
      },
      results: rows,
    });
  } catch (err) {
    next(err);
  }
});

resultsRouter.get('/subjects/:subjectId', requireRoles('admin', 'doctor'), requirePermission('results.view'), requireUuidParam('subjectId', 'Subject not found'), async (req, res, next) => {
  try {
    const subject = await prisma.subject.findUnique({
      where: { id: req.params.subjectId as string },
      select: { id: true, code: true, name: true },
    });
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    if (req.auth!.role === 'doctor') {
      const owns = await isDoctorOfSubject(req.auth!.userId, subject.id);
      if (!owns) return res.status(403).json({ error: 'You are not the doctor of this subject' });
    }

    const data = await buildCombinedResultsData(subject, req.auth!);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

const scopeSchema = z
  .string()
  .regex(/^all$|^(exam|quiz):.+$/, 'scope must be "all", "exam:{id}" or "quiz:{id}"');

resultsRouter.get('/export', requireRoles('admin', 'doctor', 'ta'), requirePermission('results.export'), async (req, res, next) => {
  try {
    const subjectIdRaw = req.query.subject_id;
    const scopeRaw = req.query.scope;

    if (typeof subjectIdRaw !== 'string' || subjectIdRaw.length === 0) {
      return res.status(400).json({ error: 'subject_id is required' });
    }
    const scopeParsed = scopeSchema.safeParse(scopeRaw);
    if (!scopeParsed.success) {
      return res.status(400).json({ error: 'Invalid scope', details: scopeParsed.error.flatten() });
    }
    const scope = scopeParsed.data;

    // Deliberately after the scope check: a request invalid on both axes must still
    // report the 400, which is what it did before this guard existed.
    if (!isUuid(subjectIdRaw)) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const subject = await prisma.subject.findUnique({
      where: { id: subjectIdRaw },
      select: { id: true, code: true, name: true },
    });
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    if (scope === 'all') {
      if (req.auth!.role === 'doctor') {
        const owns = await isDoctorOfSubject(req.auth!.userId, subject.id);
        if (!owns) return res.status(403).json({ error: 'You are not the doctor of this subject' });
      }
      const data = await buildCombinedResultsData(subject, req.auth!);
      const workbook = buildAllScopeWorkbook(data);
      await sendWorkbook(res, workbook, `${subject.code}-results-all.xlsx`);
      return;
    }

    const [kind, examId] = scope.split(':') as ['exam' | 'quiz', string];
    if (!isUuid(examId)) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { subject: { select: { id: true, code: true, name: true } } },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.subject_id !== subject.id) {
      return res.status(400).json({ error: 'scope id does not belong to subject_id' });
    }
    if (kind === 'exam' && exam.type !== 'doctor_exam') {
      return res.status(400).json({ error: 'scope "exam:{id}" must reference a doctor exam' });
    }
    if (kind === 'quiz' && exam.type !== 'ta_quiz') {
      return res.status(400).json({ error: 'scope "quiz:{id}" must reference a TA quiz' });
    }

    const access = await checkExamResultAccess(req.auth!, exam);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const rows = await getExamResultRows(exam);
    const workbook = buildSingleScopeWorkbook(exam, rows);
    await sendWorkbook(res, workbook, `${subject.code}-${exam.type}-${exam.id}.xlsx`);
  } catch (err) {
    next(err);
  }
});
