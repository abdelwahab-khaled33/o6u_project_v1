import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { requireSeb } from '../middleware/seb.js';
import { requireLabNetwork, clientIp } from '../middleware/lab-network.js';
import {
  evaluateDeviceSession,
  randomSessionToken,
  readSessionTokenFromCookieHeader,
  setSessionTokenCookie,
} from '../services/device-session.js';
import { ensureStudentExamForStudent } from '../services/exam-sampling.js';
import { finalizeStudentExam } from '../services/exam-grading.js';
import { isStudentEligibleForExam } from '../services/exam-eligibility.js';
import { evaluateAccessCodeAttempt, verifyAccessCode } from '../services/access-code.js';

export const studentExamsRouter = Router();
studentExamsRouter.use(requireAuth, requireRoles('student'), requirePermission('exam.take'));

studentExamsRouter.get('/', async (req, res, next) => {
  try {
    const studentId = req.auth!.userId;
    const now = new Date();

    const enrollments = await prisma.enrollment.findMany({
      where: { student_id: studentId },
      select: { subject_id: true },
    });
    const subjectIds = enrollments.map((e) => e.subject_id);
    if (subjectIds.length === 0) return res.json({ exams: [] });

    const memberships = await prisma.sectionMembership.findMany({
      where: { student_id: studentId },
      select: { section_id: true },
    });
    const sectionIds = memberships.map((m) => m.section_id);

    const candidates = await prisma.exam.findMany({
      where: {
        subject_id: { in: subjectIds },
        status: 'approved',
        start_time: { lte: now },
        end_time: { gt: now },
        OR: [
          { target_scope: 'subject' },
          { target_scope: 'sections', target_sections: { some: { section_id: { in: sectionIds } } } },
          { target_scope: 'student_list', target_students: { some: { student_id: studentId } } },
        ],
      },
      include: { subject: { select: { id: true, code: true, name: true } } },
      orderBy: { start_time: 'asc' },
    });

    const exams = [];
    for (const exam of candidates) {
      await ensureStudentExamForStudent(exam.id, studentId);
      const studentExam = await prisma.studentExam.findUnique({
        where: { exam_id_student_id: { exam_id: exam.id, student_id: studentId } },
        select: { status: true },
      });
      if (!studentExam || studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
        continue;
      }
      exams.push({
        id: exam.id,
        title: exam.title,
        type: exam.type,
        subject: exam.subject,
        duration_minutes: exam.duration_minutes,
        start_time: exam.start_time,
        end_time: exam.end_time,
        points_per_question: exam.points_per_question,
        status: studentExam.status,
      });
    }

    res.json({ exams });
  } catch (err) {
    next(err);
  }
});

studentExamsRouter.use(requireLabNetwork);

function deviceSessionFailure(
  req: Request,
  studentExam: { session_ip: string | null; session_token: string | null },
): { code: 'SESSION_ACTIVE_ELSEWHERE' | 'SESSION_TOKEN_INVALID' } | null {
  const result = evaluateDeviceSession({
    presentedToken: readSessionTokenFromCookieHeader(req.headers.cookie),
    requestIp: clientIp(req),
    sessionIp: studentExam.session_ip,
    sessionToken: studentExam.session_token,
  });
  return result.ok ? null : { code: result.code };
}

function deviceSessionErrorResponse(
  failure: { code: 'SESSION_ACTIVE_ELSEWHERE' | 'SESSION_TOKEN_INVALID' },
) {
  return {
    error: failure.code,
    message:
      failure.code === 'SESSION_ACTIVE_ELSEWHERE'
        ? 'Ask your supervisor to release your session'
        : 'Your exam session token is invalid; ask your supervisor to release your session',
  };
}

async function loadActiveStudentExam(examId: string, studentId: string) {
  return prisma.studentExam.findUnique({
    where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    include: { exam: true },
  });
}

function serializeQuestion(q: {
  id: string;
  question_type: string;
  text: string;
  options: unknown;
  image_url: string | null;
  difficulty: string;
  selected_answer: string | null;
  is_flagged: boolean;
  order: number;
}) {
  return {
    id: q.id,
    question_type: q.question_type,
    text: q.text,
    options: q.options,
    image_url: q.image_url,
    difficulty: q.difficulty,
    selected_answer: q.selected_answer,
    is_flagged: q.is_flagged,
    order: q.order,
  };
}

const startExamSchema = z.object({
  access_code: z.string().trim().length(6),
});

studentExamsRouter.post(
  '/:examId/start',
  requireUuidParam('examId', 'Exam not found'),
  requireSeb,
  async (req, res, next) => {
  try {
    const studentId = req.auth!.userId;
    const examId = req.params.examId as string;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'approved') return res.status(403).json({ error: 'Exam is not available' });

    const now = new Date();
    if (now < exam.start_time) return res.status(403).json({ error: 'Exam has not started yet' });
    if (now >= exam.end_time) return res.status(403).json({ error: 'Exam has ended' });

    const eligible = await isStudentEligibleForExam(exam, studentId);
    if (!eligible) return res.status(403).json({ error: 'You are not eligible for this exam' });

    await ensureStudentExamForStudent(examId, studentId);

    let studentExam = await loadActiveStudentExam(examId, studentId);
    if (!studentExam) return res.status(500).json({ error: 'Failed to initialize exam attempt' });

    if (studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
      return res.status(409).json({ error: 'This exam has already been submitted' });
    }

    if (studentExam.status === 'not_started') {
      const parsed = startExamSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'A valid access code is required' });
      if (!exam.access_code_hash || !exam.access_code_expires_at) {
        return res.status(403).json({ error: 'Access code is not available for this exam' });
      }
      if (now >= exam.access_code_expires_at) {
        return res.status(403).json({ error: 'Access code has expired' });
      }

      const windowStartedAt = studentExam.access_code_attempt_window_started_at;
      const rateLimit = evaluateAccessCodeAttempt(
        studentExam.wrong_access_code_attempts,
        windowStartedAt,
        now,
      );
      if (rateLimit.limited) {
        return res.status(429).json({
          error: 'ACCESS_CODE_RATE_LIMITED',
          message: 'Too many incorrect access-code attempts. Try again in one minute.',
        });
      }
      if (!verifyAccessCode(parsed.data.access_code, exam.access_code_hash)) {
        await prisma.studentExam.update({
          where: { id: studentExam.id },
          data: {
            wrong_access_code_attempts: rateLimit.attempts + 1,
            access_code_attempt_window_started_at:
              rateLimit.attempts > 0 && windowStartedAt != null ? windowStartedAt : now,
          },
        });
        return res.status(403).json({ error: 'Invalid access code' });
      }

      const deadline = new Date(
        Math.min(now.getTime() + exam.duration_minutes * 60000, exam.end_time.getTime()),
      );
      const token = randomSessionToken();
      await prisma.studentExam.update({
        where: { id: studentExam.id },
        data: {
          status: 'in_progress',
          started_at: now,
          deadline_at: deadline,
          last_heartbeat_at: now,
          session_ip: clientIp(req),
          session_token: token,
          wrong_access_code_attempts: 0,
          access_code_attempt_window_started_at: null,
        },
      });
      setSessionTokenCookie(res, token);
      studentExam = await loadActiveStudentExam(examId, studentId);
    } else {
      if (studentExam.deadline_at && now >= studentExam.deadline_at) {
        await finalizeStudentExam(studentExam.id, 'auto_submitted');
        return res.status(409).json({ error: 'Your time has already expired; this exam has been submitted' });
      }

      const failure = deviceSessionFailure(req, studentExam);
      if (failure) return res.status(409).json(deviceSessionErrorResponse(failure));

      const token = randomSessionToken();
      await prisma.studentExam.update({
        where: { id: studentExam.id },
        data: { session_ip: clientIp(req), session_token: token },
      });
      setSessionTokenCookie(res, token);
    }

    const questions = await prisma.studentExamQuestion.findMany({
      where: { student_exam_id: studentExam!.id },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        question_type: true,
        text: true,
        options: true,
        image_url: true,
        difficulty: true,
        selected_answer: true,
        is_flagged: true,
        order: true,
      },
    });

    res.json({
      student_exam: {
        id: studentExam!.id,
        status: studentExam!.status,
        started_at: studentExam!.started_at,
        deadline_at: studentExam!.deadline_at,
      },
      server_now: now.toISOString(),
      questions: questions.map(serializeQuestion),
    });
  } catch (err) {
    next(err);
  }
});

const answerSchema = z.object({
  question_id: z.string().min(1),
  selected_answer: z.string().trim().min(1),
});

studentExamsRouter.patch(
  '/:examId/answer',
  requireUuidParam('examId', 'Exam not found'),
  requireSeb,
  async (req, res, next) => {
  try {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid answer payload' });

    const studentExam = await loadActiveStudentExam(req.params.examId as string, req.auth!.userId);
    if (!studentExam) return res.status(404).json({ error: 'Exam attempt not found' });
    if (studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
      return res.status(409).json({ error: 'Exam already submitted' });
    }
    if (studentExam.status !== 'in_progress') {
      return res.status(409).json({ error: 'Exam has not been started' });
    }

    const failure = deviceSessionFailure(req, studentExam);
    if (failure) return res.status(409).json(deviceSessionErrorResponse(failure));

    const now = new Date();
    if (studentExam.deadline_at && now >= studentExam.deadline_at) {
      await finalizeStudentExam(studentExam.id, 'auto_submitted');
      return res.status(409).json({ error: 'Deadline passed; exam has been auto-submitted' });
    }

    const question = await prisma.studentExamQuestion.findFirst({
      where: { id: parsed.data.question_id, student_exam_id: studentExam.id },
    });
    if (!question) return res.status(404).json({ error: 'Question not found in this attempt' });

    const validOptions =
      question.question_type === 'true_false' ? ['true', 'false'] : (question.options as string[]);
    if (!validOptions.includes(parsed.data.selected_answer)) {
      return res.status(400).json({ error: 'selected_answer is not a valid option for this question' });
    }

    await prisma.studentExamQuestion.update({
      where: { id: question.id },
      data: { selected_answer: parsed.data.selected_answer },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const flagSchema = z.object({
  question_id: z.string().min(1),
  is_flagged: z.boolean(),
});

studentExamsRouter.patch(
  '/:examId/flag',
  requireUuidParam('examId', 'Exam not found'),
  requireSeb,
  async (req, res, next) => {
  try {
    const parsed = flagSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid flag payload' });

    const studentExam = await loadActiveStudentExam(req.params.examId as string, req.auth!.userId);
    if (!studentExam) return res.status(404).json({ error: 'Exam attempt not found' });
    if (studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
      return res.status(409).json({ error: 'Exam already submitted' });
    }
    if (studentExam.status !== 'in_progress') {
      return res.status(409).json({ error: 'Exam has not been started' });
    }

    const failure = deviceSessionFailure(req, studentExam);
    if (failure) return res.status(409).json(deviceSessionErrorResponse(failure));

    const now = new Date();
    if (studentExam.deadline_at && now >= studentExam.deadline_at) {
      await finalizeStudentExam(studentExam.id, 'auto_submitted');
      return res.status(409).json({ error: 'Deadline passed; exam has been auto-submitted' });
    }

    const question = await prisma.studentExamQuestion.findFirst({
      where: { id: parsed.data.question_id, student_exam_id: studentExam.id },
    });
    if (!question) return res.status(404).json({ error: 'Question not found in this attempt' });

    await prisma.studentExamQuestion.update({
      where: { id: question.id },
      data: { is_flagged: parsed.data.is_flagged },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

studentExamsRouter.post(
  '/:examId/heartbeat',
  requireUuidParam('examId', 'Exam not found'),
  requireSeb,
  async (req, res, next) => {
  try {
    const studentExam = await loadActiveStudentExam(req.params.examId as string, req.auth!.userId);
    if (!studentExam) return res.status(404).json({ error: 'Exam attempt not found' });

    const now = new Date();
    if (studentExam.status === 'in_progress' && studentExam.deadline_at && now >= studentExam.deadline_at) {
      await finalizeStudentExam(studentExam.id, 'auto_submitted');
      return res.json({ ok: true, server_now: now.toISOString(), status: 'auto_submitted' });
    }
    if (studentExam.status !== 'in_progress') {
      return res.status(409).json({ error: 'Exam is not in progress' });
    }

    const failure = deviceSessionFailure(req, studentExam);
    if (failure) return res.status(409).json(deviceSessionErrorResponse(failure));

    await prisma.studentExam.update({
      where: { id: studentExam.id },
      data: { last_heartbeat_at: now },
    });

    res.json({ ok: true, server_now: now.toISOString(), status: 'in_progress' });
  } catch (err) {
    next(err);
  }
});

studentExamsRouter.post(
  '/:examId/submit',
  requireUuidParam('examId', 'Exam not found'),
  requireSeb,
  async (req, res, next) => {
  try {
    const studentExam = await loadActiveStudentExam(req.params.examId as string, req.auth!.userId);
    if (!studentExam) return res.status(404).json({ error: 'Exam attempt not found' });
    if (studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
      return res.status(409).json({ error: 'Exam already submitted' });
    }
    if (studentExam.status !== 'in_progress') {
      return res.status(409).json({ error: 'Exam has not been started' });
    }

    const failure = deviceSessionFailure(req, studentExam);
    if (failure) return res.status(409).json(deviceSessionErrorResponse(failure));

    const now = new Date();
    if (studentExam.deadline_at && now >= studentExam.deadline_at) {
      await finalizeStudentExam(studentExam.id, 'auto_submitted');
      return res.status(409).json({ error: 'Deadline already passed; exam has been auto-submitted' });
    }

    const questions = await prisma.studentExamQuestion.findMany({
      where: { student_exam_id: studentExam.id },
      select: { id: true, selected_answer: true },
    });
    const unanswered = questions.filter((q) => !q.selected_answer);
    if (unanswered.length > 0) {
      return res.status(409).json({
        error: 'All questions must be answered before submitting',
        unanswered_count: unanswered.length,
      });
    }

    await finalizeStudentExam(studentExam.id, 'submitted');
    res.json({ ok: true, message: 'Exam submitted' });
  } catch (err) {
    next(err);
  }
});
