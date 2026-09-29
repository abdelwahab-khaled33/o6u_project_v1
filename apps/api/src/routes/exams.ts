import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { isDoctorOfSubject, taTeachesSection } from '../services/subject-access.js';
import { checkPoolSufficiency, generateStudentExamsForExam } from '../services/exam-sampling.js';
import { createAccessCodeData, decryptAccessCode } from '../services/access-code.js';
import { resolvePermissionAccess } from '../services/permissions.js';
import { EXAM_DETAIL_SELECT, EXAM_LIST_SELECT } from '../services/exam-selects.js';

export const examsRouter = Router();
examsRouter.use(requireAuth);

const difficultyMixSchema = z.object({
  easy: z.number().int().nonnegative().default(0),
  medium: z.number().int().nonnegative().default(0),
  hard: z.number().int().nonnegative().default(0),
});

const createExamSchema = z.object({
  subject_id: z.string().min(1),
  title: z.string().trim().min(2).max(150),
  question_pool_ids: z.array(z.string().min(1)).min(1),
  difficulty_mix: difficultyMixSchema,
  points_per_question: z.number().positive(),
  duration_minutes: z.number().int().positive().max(360),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  target_scope: z.enum(['subject', 'sections', 'student_list']),
  target_section_ids: z.array(z.string().min(1)).optional(),
  target_student_ids: z.array(z.string().min(1)).optional(),
  quiz_source: z.enum(['shared_bank', 'own_questions']).optional(),
});

const updateExamSchema = createExamSchema.partial().omit({ subject_id: true });

function mixTotal(mix: { easy: number; medium: number; hard: number }): number {
  return mix.easy + mix.medium + mix.hard;
}

async function validatePool(params: {
  subjectId: string;
  poolIds: string[];
  role: 'doctor' | 'ta';
  userId: string;
  quizSource?: 'shared_bank' | 'own_questions';
  mix: { easy: number; medium: number; hard: number };
}): Promise<string | null> {
  const questions = await prisma.question.findMany({
    where: { id: { in: params.poolIds }, is_archived: false },
  });
  if (questions.length !== params.poolIds.length) {
    return 'Some pool questions were not found or are archived';
  }

  for (const q of questions) {
    if (q.subject_id !== params.subjectId) {
      return 'All pool questions must belong to the exam subject';
    }
    if (params.role === 'doctor') {
      if (q.owner_type !== 'doctor' || q.doctor_id !== params.userId) {
        return 'Pool must come from your own doctor question bank';
      }
    } else {
      if (q.owner_type !== 'ta_shared') {
        return 'Pool must come from the shared TA question bank';
      }
      if (params.quizSource === 'own_questions' && q.added_by_ta_id !== params.userId) {
        return 'Pool must be limited to your own questions when quiz_source is own_questions';
      }
    }
  }

  const sufficiency = checkPoolSufficiency(questions, params.mix);
  if (!sufficiency.ok) return sufficiency.error;

  return null;
}

async function validateTargets(params: {
  subjectId: string;
  role: 'doctor' | 'ta';
  userId: string;
  targetScope: 'subject' | 'sections' | 'student_list';
  sectionIds?: string[];
  studentIds?: string[];
}): Promise<string | null> {
  if (params.role === 'ta' && params.targetScope === 'subject') {
    return 'TAs cannot target an entire subject; use sections or student_list';
  }

  if (params.targetScope === 'sections') {
    if (!params.sectionIds || params.sectionIds.length === 0) {
      return 'target_section_ids is required for sections scope';
    }
    const sections = await prisma.section.findMany({ where: { id: { in: params.sectionIds } } });
    if (sections.length !== params.sectionIds.length) {
      return 'Some target sections were not found';
    }
    for (const s of sections) {
      if (s.subject_id !== params.subjectId) {
        return 'Target sections must belong to the exam subject';
      }
      if (params.role === 'ta' && s.ta_id !== params.userId) {
        return 'You can only target sections you teach';
      }
    }
  }

  if (params.targetScope === 'student_list') {
    if (!params.studentIds || params.studentIds.length === 0) {
      return 'target_student_ids is required for student_list scope';
    }
    const enrollments = await prisma.enrollment.findMany({
      where: { subject_id: params.subjectId, student_id: { in: params.studentIds } },
    });
    if (enrollments.length !== params.studentIds.length) {
      return 'Some target students are not enrolled in this subject';
    }
    if (params.role === 'ta') {
      const memberships = await prisma.sectionMembership.findMany({
        where: {
          student_id: { in: params.studentIds },
          section: { ta_id: params.userId, subject_id: params.subjectId },
        },
      });
      if (memberships.length !== params.studentIds.length) {
        return 'Target students must be in one of your own sections';
      }
    }
  }

  return null;
}

function isUpcoming(startTime: Date): boolean {
  return new Date() < startTime;
}

examsRouter.post('/', requireRoles('doctor', 'ta'), async (req, res, next) => {
  try {
    const role = req.auth!.role as 'doctor' | 'ta';
    const permissionKey = role === 'doctor' ? 'exam.create' : 'quiz.create';
    const access = await resolvePermissionAccess(req.auth!.userId, role, permissionKey);
    if (!access.active || !access.permission.allowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const parsed = createExamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exam payload', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const userId = req.auth!.userId;

    const startTime = new Date(data.start_time);
    const endTime = new Date(data.end_time);
    if (endTime <= startTime) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }
    if (data.duration_minutes > (endTime.getTime() - startTime.getTime()) / 60000) {
      return res.status(400).json({ error: 'duration_minutes cannot exceed the start/end window' });
    }
    if (mixTotal(data.difficulty_mix) === 0) {
      return res.status(400).json({ error: 'difficulty_mix must request at least one question' });
    }

    let type: 'doctor_exam' | 'ta_quiz';
    let status: 'pending_approval' | 'approved';

    if (role === 'doctor') {
      const owns = await isDoctorOfSubject(userId, data.subject_id);
      if (!owns) return res.status(403).json({ error: 'You are not the doctor of this subject' });
      type = 'doctor_exam';
      status = 'pending_approval';
    } else {
      const teaches = await taTeachesSection(userId, data.subject_id);
      if (!teaches) return res.status(403).json({ error: 'You do not teach a section in this subject' });
      if (!data.quiz_source) {
        return res.status(400).json({ error: 'quiz_source is required for TA quizzes' });
      }
      type = 'ta_quiz';
      status = 'approved';
    }

    const poolError = await validatePool({
      subjectId: data.subject_id,
      poolIds: data.question_pool_ids,
      role,
      userId,
      quizSource: data.quiz_source,
      mix: data.difficulty_mix,
    });
    if (poolError) return res.status(400).json({ error: poolError });

    const targetError = await validateTargets({
      subjectId: data.subject_id,
      role,
      userId,
      targetScope: data.target_scope,
      sectionIds: data.target_section_ids,
      studentIds: data.target_student_ids,
    });
    if (targetError) return res.status(400).json({ error: targetError });

    const exam = await prisma.$transaction(
      async (tx) => {
        const accessCodeData = status === 'approved' ? createAccessCodeData() : null;
        const created = await tx.exam.create({
          data: {
            subject_id: data.subject_id,
            type,
            created_by: userId,
            owner_id: userId,
            title: data.title,
            status,
            ...(accessCodeData
              ? {
                  access_code_hash: accessCodeData.access_code_hash,
                  access_code_encrypted: accessCodeData.access_code_encrypted,
                  access_code_expires_at: endTime,
                }
              : {}),
            points_per_question: data.points_per_question,
            duration_minutes: data.duration_minutes,
            start_time: startTime,
            end_time: endTime,
            difficulty_mix: data.difficulty_mix,
            target_scope: data.target_scope,
            quiz_source: role === 'ta' ? data.quiz_source : null,
            ...(status === 'approved'
              ? { approved_by: userId, approved_at: new Date() }
              : {}),
          },
          select: EXAM_DETAIL_SELECT,
        });

        await tx.examQuestion.createMany({
          data: data.question_pool_ids.map((question_id) => ({
            exam_id: created.id,
            question_id,
          })),
        });

        if (data.target_scope === 'sections' && data.target_section_ids) {
          await tx.examTargetSection.createMany({
            data: data.target_section_ids.map((section_id) => ({
              exam_id: created.id,
              section_id,
            })),
          });
        }
        if (data.target_scope === 'student_list' && data.target_student_ids) {
          await tx.examTargetStudent.createMany({
            data: data.target_student_ids.map((student_id) => ({
              exam_id: created.id,
              student_id,
            })),
          });
        }

        if (status === 'approved') {
          await generateStudentExamsForExam(tx, created.id);
        }

        return created;
      },
      { timeout: 60000 },
    );

    res.status(201).json({ exam });
  } catch (err) {
    next(err);
  }
});

const examListQuerySchema = z.object({
  subject_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'locked', 'closed']).optional(),
});

examsRouter.get('/', requireRoles('admin', 'doctor', 'ta'), async (req, res, next) => {
  try {
    const parsed = examListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exam filter' });
    }

    const exams = await prisma.exam.findMany({
      where: {
        owner_id: req.auth!.userId,
        ...(parsed.data.subject_id ? { subject_id: parsed.data.subject_id } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
      select: EXAM_LIST_SELECT,
      orderBy: { created_at: 'desc' },
    });
    res.json({ exams });
  } catch (err) {
    next(err);
  }
});

examsRouter.get('/:id', requireUuidParam('id', 'Exam not found'), async (req, res, next) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: EXAM_DETAIL_SELECT,
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (req.auth!.role === 'admin' && exam.owner_id !== req.auth!.userId) {
      const access = await resolvePermissionAccess(req.auth!.userId, 'admin', 'exams.manage_all');
      if (!access.active || !access.permission.allowed) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    const role = req.auth!.role;
    if (role !== 'admin' && exam.owner_id !== req.auth!.userId) {
      return res.status(403).json({ error: 'You do not own this exam' });
    }

    res.json({ exam });
  } catch (err) {
    next(err);
  }
});

examsRouter.get(
  '/:id/access-code',
  requireRoles('admin', 'doctor', 'ta'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        owner_id: true,
        access_code_encrypted: true,
        access_code_expires_at: true,
      },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (req.auth!.role === 'admin' && exam.owner_id !== req.auth!.userId) {
      const access = await resolvePermissionAccess(req.auth!.userId, 'admin', 'exams.manage_all');
      if (!access.active || !access.permission.allowed) return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (req.auth!.role !== 'admin' && exam.owner_id !== req.auth!.userId) {
      return res.status(403).json({ error: 'You do not own this exam' });
    }
    if (!exam.access_code_encrypted || !exam.access_code_expires_at) {
      return res.status(409).json({ error: 'An access code is not available for this exam' });
    }

    res.json({
      access_code: decryptAccessCode(exam.access_code_encrypted),
      access_code_expires_at: exam.access_code_expires_at,
    });
  } catch (err) {
    next(err);
  }
});

examsRouter.get(
  '/:examId/live',
  requireRoles('admin', 'doctor', 'ta'),
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

    if (role === 'admin' && exam.owner_id !== userId) {
      const access = await resolvePermissionAccess(userId, 'admin', 'exams.manage_all');
      if (!access.active || !access.permission.allowed) return res.status(403).json({ error: 'Insufficient permissions' });
    } else if (role === 'doctor') {
      if (exam.type === 'doctor_exam') {
        if (exam.owner_id !== userId) {
          return res.status(403).json({ error: 'You do not own this exam' });
        }
      } else if (exam.type === 'ta_quiz') {
        const owns = await isDoctorOfSubject(userId, exam.subject_id);
        if (!owns) return res.status(403).json({ error: 'You are not the doctor of this subject' });
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (role === 'ta' && (exam.type !== 'ta_quiz' || exam.owner_id !== userId)) {
      return res.status(403).json({ error: 'You can only monitor your own quizzes' });
    }

    const studentExams = await prisma.studentExam.findMany({
      where: { exam_id: exam.id },
      select: {
        id: true,
        status: true,
        last_heartbeat_at: true,
        deadline_at: true,
        session_token: true,
        student: { select: { id: true, full_name: true, student_code: true } },
        questions: {
          where: { selected_answer: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { student: { full_name: 'asc' } },
    });

    const now = Date.now();
    const attempts = studentExams.map((attempt) => ({
      student_exam_id: attempt.id,
      student: attempt.student,
      status: attempt.status,
      ...(attempt.status === 'in_progress'
        ? {
            online:
              attempt.last_heartbeat_at != null &&
              now - attempt.last_heartbeat_at.getTime() <= 60_000,
          }
        : {}),
      answered_count: attempt.questions.length,
      deadline_at: attempt.deadline_at,
      has_active_session: attempt.session_token != null,
    }));

    res.json({ exam_id: exam.id, attempts });
  } catch (err) {
    next(err);
  }
});

examsRouter.patch(
  '/:id',
  requireRoles('admin', 'doctor', 'ta'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const existing = await prisma.exam.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ error: 'Exam not found' });

    const role = req.auth!.role;
    if (role === 'admin' && existing.owner_id !== req.auth!.userId) {
      const access = await resolvePermissionAccess(req.auth!.userId, 'admin', 'exams.manage_all');
      if (!access.active || !access.permission.allowed) return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (role !== 'admin' && existing.owner_id !== req.auth!.userId) {
      return res.status(403).json({ error: 'You do not own this exam' });
    }
    if (!isUpcoming(existing.start_time)) {
      return res.status(409).json({ error: 'Exam is immutable once its start time has passed' });
    }

    const parsed = updateExamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exam payload', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const startTime = data.start_time ? new Date(data.start_time) : existing.start_time;
    const endTime = data.end_time ? new Date(data.end_time) : existing.end_time;
    const duration = data.duration_minutes ?? existing.duration_minutes;
    if (endTime <= startTime) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }
    if (duration > (endTime.getTime() - startTime.getTime()) / 60000) {
      return res.status(400).json({ error: 'duration_minutes cannot exceed the start/end window' });
    }

    const mix = data.difficulty_mix ??
      (existing.difficulty_mix as { easy: number; medium: number; hard: number });

    const isTa = existing.type === 'ta_quiz';
    const poolIds = data.question_pool_ids;
    if (poolIds) {
      const poolError = await validatePool({
        subjectId: existing.subject_id,
        poolIds,
        role: isTa ? 'ta' : 'doctor',
        userId: existing.owner_id,
        quizSource: data.quiz_source ?? existing.quiz_source ?? undefined,
        mix,
      });
      if (poolError) return res.status(400).json({ error: poolError });
    } else if (data.difficulty_mix) {
      const currentPool = await prisma.examQuestion.findMany({
        where: { exam_id: existing.id },
        include: { question: { select: { difficulty: true } } },
      });
      const sufficiency = checkPoolSufficiency(
        currentPool.map((p) => p.question),
        mix,
      );
      if (!sufficiency.ok) return res.status(400).json({ error: sufficiency.error });
    }

    const targetScope = data.target_scope ?? existing.target_scope;
    if (data.target_scope || data.target_section_ids || data.target_student_ids) {
      const targetError = await validateTargets({
        subjectId: existing.subject_id,
        role: isTa ? 'ta' : 'doctor',
        userId: existing.owner_id,
        targetScope,
        sectionIds: data.target_section_ids,
        studentIds: data.target_student_ids,
      });
      if (targetError) return res.status(400).json({ error: targetError });
    }

    const wasApproved = existing.status === 'approved';
    const doctorEditsApproved = role === 'doctor' && wasApproved;
    const newStatus = doctorEditsApproved ? 'pending_approval' : existing.status;

    const updated = await prisma.$transaction(
      async (tx) => {
        const exam = await tx.exam.update({
          where: { id: existing.id },
          data: {
            title: data.title,
            points_per_question: data.points_per_question,
            duration_minutes: data.duration_minutes,
            start_time: data.start_time ? startTime : undefined,
            end_time: data.end_time ? endTime : undefined,
            difficulty_mix: data.difficulty_mix,
            target_scope: data.target_scope,
            quiz_source: data.quiz_source,
            status: newStatus,
            ...(doctorEditsApproved ? { approved_by: null, approved_at: null } : {}),
            ...(role === 'admin' && wasApproved
              ? { approved_by: req.auth!.userId, approved_at: new Date() }
              : {}),
          },
          select: EXAM_DETAIL_SELECT,
        });

        if (poolIds) {
          await tx.examQuestion.deleteMany({ where: { exam_id: existing.id } });
          await tx.examQuestion.createMany({
            data: poolIds.map((question_id) => ({ exam_id: existing.id, question_id })),
          });
        }

        if (data.target_section_ids) {
          await tx.examTargetSection.deleteMany({ where: { exam_id: existing.id } });
          await tx.examTargetSection.createMany({
            data: data.target_section_ids.map((section_id) => ({
              exam_id: existing.id,
              section_id,
            })),
          });
        }
        if (data.target_student_ids) {
          await tx.examTargetStudent.deleteMany({ where: { exam_id: existing.id } });
          await tx.examTargetStudent.createMany({
            data: data.target_student_ids.map((student_id) => ({
              exam_id: existing.id,
              student_id,
            })),
          });
        }

        await tx.studentExam.deleteMany({ where: { exam_id: existing.id } });

        if (exam.status === 'approved') {
          await generateStudentExamsForExam(tx, exam.id);
        }

        return exam;
      },
      { timeout: 60000 },
    );

    res.json({ exam: updated });
  } catch (err) {
    next(err);
  }
});

examsRouter.delete(
  '/:id',
  requireRoles('admin', 'doctor', 'ta'),
  requireUuidParam('id', 'Exam not found'),
  async (req, res, next) => {
  try {
    const existing = await prisma.exam.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ error: 'Exam not found' });

    const role = req.auth!.role;
    if (role === 'admin' && existing.owner_id !== req.auth!.userId) {
      const access = await resolvePermissionAccess(req.auth!.userId, 'admin', 'exams.manage_all');
      if (!access.active || !access.permission.allowed) return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (role !== 'admin' && existing.owner_id !== req.auth!.userId) {
      return res.status(403).json({ error: 'You do not own this exam' });
    }

    const upcoming = isUpcoming(existing.start_time);
    const neverApproved = existing.status !== 'approved';
    if (!upcoming && !neverApproved) {
      return res.status(409).json({ error: 'Exam cannot be deleted once it has started' });
    }

    await prisma.exam.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

examsRouter.post(
  '/:examId/attempts/:studentExamId/release',
  requireRoles('admin', 'doctor', 'ta'),
  requirePermission('sessions.release'),
  // The exam is authorized first and the attempt second, so the two guards sit in that
  // order: a well-formed exam id is expected to reach the database, a malformed one is not.
  requireUuidParam('examId', 'Exam not found'),
  requireUuidParam('studentExamId', 'Exam attempt not found'),
  async (req, res, next) => {
    try {
      const exam = await prisma.exam.findUnique({
        where: { id: req.params.examId as string },
        select: { id: true, type: true, owner_id: true, subject_id: true },
      });
      if (!exam) return res.status(404).json({ error: 'Exam not found' });

      const role = req.auth!.role;
      const userId = req.auth!.userId;

      if (role === 'admin' && exam.owner_id !== userId) {
        const access = await resolvePermissionAccess(userId, 'admin', 'exams.manage_all');
        if (!access.active || !access.permission.allowed) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      } else if (role === 'doctor') {
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
      } else if (role === 'ta') {
        if (exam.type !== 'ta_quiz' || exam.owner_id !== userId) {
          return res.status(403).json({ error: 'You can only release sessions for your own quizzes' });
        }
      }

      const studentExam = await prisma.studentExam.findUnique({
        where: { id: req.params.studentExamId as string },
        select: { id: true, exam_id: true },
      });
      if (!studentExam || studentExam.exam_id !== exam.id) {
        return res.status(404).json({ error: 'Exam attempt not found' });
      }

      await prisma.studentExam.update({
        where: { id: studentExam.id },
        data: {
          session_ip: null,
          session_token: null,
          session_released_by: userId,
          session_released_at: new Date(),
        },
      });

      res.json({
        ok: true,
        message: 'Session released; the student can resume on a replacement device',
      });
    } catch (err) {
      next(err);
    }
  },
);
