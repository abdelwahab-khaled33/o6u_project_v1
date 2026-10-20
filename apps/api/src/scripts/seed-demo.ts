import '../config/env.js';
import bcrypt from 'bcryptjs';
import type { ExamStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateStudentExamsForExam } from '../services/exam-sampling.js';
import { finalizeStudentExam } from '../services/exam-grading.js';
import { applyGradeCompensation } from '../services/grade-adjustment.js';
import { createAccessCodeData, decryptAccessCode } from '../services/access-code.js';
import { canChangePasswordForCreate } from '../services/admin-management.js';
import type { DemoExam } from './demo-seed-data.js';
import {
  DEMO_PASSWORD,
  demoUsers,
  demoSubjects,
  demoSections,
  demoEnrollments,
  demoDoctorAssignments,
  demoQuestions,
  demoExams,
  examWindow,
  eligibilityUsernames,
  attemptPlanFor,
  attemptTimestamps,
  answeredCountFor,
  answerFor,
  shouldFlag,
  pickCompensationTargets,
} from './demo-seed-data.js';

function mustGet<V>(map: Map<string, V>, key: string): V {
  const value = map.get(key);
  if (value == null) {
    throw new Error(`Demo data references unknown key: ${key}`);
  }
  return value;
}

async function applyAttemptPlan(
  exam: DemoExam,
  examId: string,
  window: { start: Date; end: Date },
  now: Date,
  userIds: Map<string, string>,
): Promise<void> {
  const usernameById = new Map<string, string>();
  for (const [username, id] of userIds) usernameById.set(id, username);

  const eligible = eligibilityUsernames(exam, demoEnrollments, demoSections);
  const plan = attemptPlanFor(exam, eligible);
  const attempts = await prisma.studentExam.findMany({
    where: { exam_id: examId },
    include: { questions: { orderBy: { order: 'asc' } } },
  });

  for (const attempt of attempts) {
    const username = usernameById.get(attempt.student_id);
    if (username == null) continue;
    const entry = plan[username];
    if (entry == null || entry === 'not_started') continue;
    const studentIdx = eligible.indexOf(username);
    if (studentIdx < 0) continue;

    const ts = attemptTimestamps(now, window, exam.durationMinutes, entry, studentIdx);
    const finished = attempt.status === 'submitted' || attempt.status === 'auto_submitted';

    if (finished) {
      if (entry !== 'in_progress') {
        await prisma.studentExam.update({
          where: { id: attempt.id },
          data: { started_at: ts.startedAt, deadline_at: ts.deadline, submitted_at: ts.submittedAt },
        });
      }
      continue;
    }

    const answered = answeredCountFor(entry, studentIdx, attempt.questions.length);
    const snapshotOps = attempt.questions.map((snap) =>
      prisma.studentExamQuestion.update({
        where: { id: snap.id },
        data: {
          selected_answer:
            snap.order < answered
              ? answerFor(
                  {
                    question_type: snap.question_type,
                    options: snap.options as string[],
                    correct_answer: snap.correct_answer,
                  },
                  studentIdx,
                  snap.order,
                )
              : null,
          is_flagged: shouldFlag(entry, studentIdx, snap.order),
        },
      }),
    );
    if (snapshotOps.length > 0) {
      await prisma.$transaction(snapshotOps);
    }

    if (entry === 'in_progress') {
      await prisma.studentExam.update({
        where: { id: attempt.id },
        data: {
          status: 'in_progress',
          started_at: ts.startedAt,
          deadline_at: ts.deadline,
          submitted_at: null,
          total_grade: null,
          last_heartbeat_at: ts.heartbeatAt,
        },
      });
      continue;
    }

    await finalizeStudentExam(attempt.id, entry === 'submit' ? 'submitted' : 'auto_submitted');
    await prisma.studentExam.update({
      where: { id: attempt.id },
      data: { started_at: ts.startedAt, deadline_at: ts.deadline, submitted_at: ts.submittedAt },
    });
  }
}

async function compensateExam(exam: DemoExam, examId: string, actorId: string): Promise<void> {
  const existing = await prisma.gradeAdjustment.count({
    where: { student_exam_question: { student_exam: { exam_id: examId } } },
  });
  if (existing > 0) return;

  const rows = await prisma.studentExamQuestion.findMany({
    where: { student_exam: { exam_id: examId }, grade_awarded: { not: null } },
    select: {
      student_exam_id: true,
      question_id: true,
      selected_answer: true,
      correct_answer: true,
    },
  });
  const targets = pickCompensationTargets(
    rows.map((row) => ({
      studentExamId: row.student_exam_id,
      questionId: row.question_id,
      selectedAnswer: row.selected_answer,
      correctAnswer: row.correct_answer,
    })),
  );
  if (targets.fullCredit != null) {
    const result = await applyGradeCompensation({
      sourceQuestionId: targets.fullCredit.questionId,
      examId,
      adjustmentType: 'full_credit',
      studentExamIds: targets.fullCredit.studentExamIds,
      reason: 'Demo compensation: everyone who missed this question receives full credit.',
      actorId,
    });
    console.log(`  compensation full_credit: ${result.adjustmentCount} row(s)`);
  }
  if (targets.setPoints != null) {
    const result = await applyGradeCompensation({
      sourceQuestionId: targets.setPoints.questionId,
      examId,
      adjustmentType: 'set_points',
      points: Number((exam.pointsPerQuestion / 2).toFixed(2)),
      studentExamIds: targets.setPoints.studentExamIds,
      reason: 'Demo compensation: partial credit restored for this question.',
      actorId,
    });
    console.log(`  compensation set_points: ${result.adjustmentCount} row(s)`);
  }
}

async function verifyGradeInvariant(examIds: string[]): Promise<number> {
  const attempts = await prisma.studentExam.findMany({
    where: { exam_id: { in: examIds }, status: { in: ['submitted', 'auto_submitted'] } },
    include: { questions: { select: { grade_awarded: true } } },
  });
  const violations: string[] = [];
  for (const attempt of attempts) {
    const sum = attempt.questions.reduce(
      (acc, q) => acc + (q.grade_awarded != null ? Number(q.grade_awarded) : 0),
      0,
    );
    const total = attempt.total_grade != null ? Number(attempt.total_grade) : null;
    if (total == null || Math.abs(total - sum) > 1e-9) {
      violations.push(`attempt ${attempt.id}: total_grade=${total ?? 'null'} sum=${sum}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Grade invariant (total_grade == sum of grade_awarded) violated:\n  ${violations.join('\n  ')}`,
    );
  }
  return attempts.length;
}

async function run(): Promise<void> {
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (admin == null) {
    throw new Error('Admin user "admin" not found. Run `npm run db:seed` before the demo seed.');
  }

  const subjectIds = new Map<string, string>();
  for (const subject of demoSubjects) {
    const row = await prisma.subject.upsert({
      where: { code: subject.code },
      create: { code: subject.code, name: subject.name },
      update: { name: subject.name },
    });
    subjectIds.set(subject.code, row.id);
  }
  console.log(`Subjects: ${subjectIds.size}`);

  const userIds = new Map<string, string>();
  for (const user of demoUsers) {
    const role = user.role;
    const row = await prisma.user.upsert({
      where: { username: user.username },
      create: {
        username: user.username,
        password_hash: passwordHash,
        full_name: user.full_name,
        role,
        student_code: user.student_code ?? null,
        can_change_password: canChangePasswordForCreate(role, true),
        is_active: true,
      },
      update: {
        password_hash: passwordHash,
        full_name: user.full_name,
        role,
        student_code: user.student_code ?? null,
        can_change_password: canChangePasswordForCreate(role, true),
        is_active: true,
      },
    });
    userIds.set(user.username, row.id);
  }
  console.log(`Demo users: ${userIds.size}`);

  for (const assignment of demoDoctorAssignments) {
    const doctorId = mustGet(userIds, assignment.doctorUsername);
    const subjectId = mustGet(subjectIds, assignment.subjectCode);
    await prisma.doctorAssignment.upsert({
      where: { doctor_id_subject_id: { doctor_id: doctorId, subject_id: subjectId } },
      create: { doctor_id: doctorId, subject_id: subjectId },
      update: {},
    });
  }

  const sectionIds = new Map<string, string>();
  for (const section of demoSections) {
    const subjectId = mustGet(subjectIds, section.subjectCode);
    const taId = mustGet(userIds, section.taUsername);
    const key = `${section.subjectCode}|${section.name}`;
    const existing = await prisma.section.findFirst({
      where: { subject_id: subjectId, name: section.name },
    });
    if (existing == null) {
      const row = await prisma.section.create({
        data: { subject_id: subjectId, ta_id: taId, name: section.name },
      });
      sectionIds.set(key, row.id);
      continue;
    }
    if (existing.ta_id !== taId) {
      await prisma.section.update({ where: { id: existing.id }, data: { ta_id: taId } });
    }
    sectionIds.set(key, existing.id);
  }
  console.log(`Sections: ${sectionIds.size}`);

  for (const enrollment of demoEnrollments) {
    const studentId = mustGet(userIds, enrollment.studentUsername);
    const subjectId = mustGet(subjectIds, enrollment.subjectCode);
    const sectionId = mustGet(sectionIds, `${enrollment.subjectCode}|${enrollment.sectionName}`);
    await prisma.enrollment.upsert({
      where: { student_id_subject_id: { student_id: studentId, subject_id: subjectId } },
      create: { student_id: studentId, subject_id: subjectId },
      update: {},
    });
    await prisma.sectionMembership.upsert({
      where: { student_id_section_id: { student_id: studentId, section_id: sectionId } },
      create: { student_id: studentId, section_id: sectionId },
      update: {},
    });
    await prisma.sectionMembership.deleteMany({
      where: {
        student_id: studentId,
        section_id: { not: sectionId },
        section: { subject_id: subjectId },
      },
    });
  }
  console.log(`Enrollments: ${demoEnrollments.length} students across ${demoSections.length} sections`);

  const existingQuestions = await prisma.question.findMany({
    where: { subject_id: { in: [...subjectIds.values()] } },
    select: { id: true, subject_id: true, text: true },
  });
  const questionIdByText = new Map<string, string>();
  for (const row of existingQuestions) {
    questionIdByText.set(`${row.subject_id}|${row.text}`, row.id);
  }

  let questionsCreated = 0;
  let questionsUpdated = 0;
  const questionOps = demoQuestions.map((question) => {
    const subjectId = mustGet(subjectIds, question.subjectCode);
    const ownerId = mustGet(userIds, question.ownerUsername);
    const data = {
      owner_type: question.ownerType,
      doctor_id: question.ownerType === 'doctor' ? ownerId : null,
      added_by_ta_id: question.ownerType === 'ta_shared' ? ownerId : null,
      question_type: question.questionType,
      options: question.options,
      correct_answer: question.correctAnswer,
      grade: question.grade,
      difficulty: question.difficulty,
      is_archived: false,
    };
    const existingId = questionIdByText.get(`${subjectId}|${question.text}`);
    if (existingId == null) {
      questionsCreated += 1;
      return prisma.question.create({
        data: { subject_id: subjectId, text: question.text, image_url: null, ...data },
      });
    }
    questionsUpdated += 1;
    return prisma.question.update({ where: { id: existingId }, data });
  });
  await prisma.$transaction(questionOps);
  console.log(`Questions: ${questionsCreated} created, ${questionsUpdated} updated`);

  const examIds = new Map<string, string>();

  for (const exam of demoExams) {
    const ownerId = mustGet(userIds, exam.ownerUsername);
    const subjectId = mustGet(subjectIds, exam.subjectCode);
    const window = examWindow(now, exam.window);
    const approvedAt = new Date(Math.min(now.getTime(), window.start.getTime() - 3_600_000));

    const existing = await prisma.exam.findFirst({
      where: { owner_id: ownerId, title: exam.title },
    });
    let examId: string;
    let status: ExamStatus;

    if (existing == null) {
      const code = exam.status === 'approved' ? createAccessCodeData() : null;
      const row = await prisma.exam.create({
        data: {
          subject_id: subjectId,
          type: exam.type,
          created_by: ownerId,
          owner_id: ownerId,
          title: exam.title,
          status: exam.status,
          rejection_reason: exam.rejectionReason ?? null,
          approved_by:
            exam.status === 'approved' ? (exam.type === 'ta_quiz' ? ownerId : admin.id) : null,
          approved_at: exam.status === 'approved' ? approvedAt : null,
          access_code_hash: code?.access_code_hash ?? null,
          access_code_encrypted: code?.access_code_encrypted ?? null,
          access_code_expires_at: code == null ? null : window.end,
          start_time: window.start,
          end_time: window.end,
          duration_minutes: exam.durationMinutes,
          difficulty_mix: exam.mix,
          points_per_question: exam.pointsPerQuestion,
          target_scope: exam.type === 'ta_quiz' ? 'sections' : 'subject',
          quiz_source: exam.quizSource ?? null,
        },
      });
      examId = row.id;
      status = row.status;
    } else {
      const data: {
        start_time: Date;
        end_time: Date;
        duration_minutes: number;
        difficulty_mix: typeof exam.mix;
        points_per_question: number;
        target_scope: 'subject' | 'sections';
        quiz_source: 'own_questions' | null;
        approved_by?: string;
        approved_at?: Date;
        access_code_hash?: string;
        access_code_encrypted?: string;
        access_code_expires_at?: Date;
      } = {
        start_time: window.start,
        end_time: window.end,
        duration_minutes: exam.durationMinutes,
        difficulty_mix: exam.mix,
        points_per_question: exam.pointsPerQuestion,
        target_scope: exam.type === 'ta_quiz' ? 'sections' : 'subject',
        quiz_source: exam.quizSource ?? null,
      };
      if (existing.status === 'approved') {
        if (existing.approved_by == null) {
          data.approved_by = exam.type === 'ta_quiz' ? ownerId : admin.id;
          data.approved_at = approvedAt;
        }
        if (existing.access_code_hash == null || existing.access_code_encrypted == null) {
          const code = createAccessCodeData();
          data.access_code_hash = code.access_code_hash;
          data.access_code_encrypted = code.access_code_encrypted;
        }
        data.access_code_expires_at = window.end;
      }
      const row = await prisma.exam.update({ where: { id: existing.id }, data });
      examId = row.id;
      status = row.status;
    }

    examIds.set(exam.key, examId);
    console.log(`Exam "${exam.title}": ${status}`);

    if (status !== 'approved') continue;

    const poolQuestions = await prisma.question.findMany({
      where:
        exam.type === 'ta_quiz'
          ? {
              subject_id: subjectId,
              owner_type: 'ta_shared',
              added_by_ta_id: ownerId,
              is_archived: false,
            }
          : {
              subject_id: subjectId,
              owner_type: 'doctor',
              doctor_id: ownerId,
              is_archived: false,
            },
      select: { id: true },
    });
    if (poolQuestions.length === 0) {
      throw new Error(`No pool questions found for approved exam "${exam.title}".`);
    }
    await prisma.examQuestion.createMany({
      data: poolQuestions.map((question) => ({ exam_id: examId, question_id: question.id })),
      skipDuplicates: true,
    });

    if (exam.targetSections != null && exam.targetSections.length > 0) {
      await prisma.examTargetSection.createMany({
        data: exam.targetSections.map((name) => ({
          exam_id: examId,
          section_id: mustGet(sectionIds, `${exam.subjectCode}|${name}`),
        })),
        skipDuplicates: true,
      });
    }

    const generation = await prisma.$transaction((tx) => generateStudentExamsForExam(tx, examId));
    console.log(`  attempts generated: ${generation.generated}`);

    if (exam.attemptPlan != null) {
      await applyAttemptPlan(exam, examId, window, now, userIds);
    }
    if (exam.compensation === true) {
      await compensateExam(exam, examId, ownerId);
    }
  }

  const checked = await verifyGradeInvariant([...examIds.values()]);
  console.log(`Grade invariant verified on ${checked} finished attempt(s).`);

  const attemptCounts = await prisma.studentExam.groupBy({
    by: ['status'],
    where: { exam_id: { in: [...examIds.values()] } },
    _count: true,
  });
  const adjustmentCount = await prisma.gradeAdjustment.count({
    where: { student_exam_question: { student_exam: { exam_id: { in: [...examIds.values()] } } } },
  });

  console.log('\nDemo seed complete.');
  console.log(`Attempts: ${attemptCounts.map((c) => `${c.status}=${c._count}`).join(', ')}`);
  console.log(`Grade adjustments: ${adjustmentCount}`);

  console.log('\nCredentials (demo data):');
  console.log('  admin / admin123 (from npm run db:seed)');
  for (const user of demoUsers) {
    const code = user.student_code == null ? '' : `  student code ${user.student_code}`;
    console.log(`  ${user.username} / ${DEMO_PASSWORD}  [${user.role}]${code}`);
  }

  console.log('\nAccess codes (demo data):');
  for (const exam of demoExams) {
    const row = await prisma.exam.findUnique({
      where: { id: mustGet(examIds, exam.key) },
      select: { access_code_encrypted: true, access_code_expires_at: true },
    });
    if (row?.access_code_encrypted == null) continue;
    const expiry =
      row.access_code_expires_at == null
        ? 'no expiry'
        : `${row.access_code_expires_at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const expired =
      row.access_code_expires_at != null && row.access_code_expires_at.getTime() < now.getTime();
    console.log(
      `  ${exam.title}: ${decryptAccessCode(row.access_code_encrypted)} (valid until ${expiry}${expired ? ' — already ended' : ''})`,
    );
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
