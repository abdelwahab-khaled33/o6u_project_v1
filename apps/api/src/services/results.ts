import type { Exam } from '@prisma/client';
import type { AuthPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { getEligibleStudentIds } from './exam-eligibility.js';
import { isDoctorOfSubject } from './subject-access.js';

type DifficultyMix = { easy: number; medium: number; hard: number };

export type ResultAccess = { ok: true } | { ok: false; status: number; error: string };

export type ResultRow = {
  student_id: string;
  student_name: string;
  student_code: string | null;
  section: { id: string; name: string; ta: { id: string; full_name: string } } | null;
  status: string;
  grade: number | null;
};

export type ResultColumn = {
  id: string;
  type: 'doctor_exam' | 'ta_quiz';
  title: string;
  max_grade: number;
  owner: { id: string; full_name: string };
};

export type CombinedSectionView = {
  section: { id: string; name: string };
  ta: { id: string; full_name: string };
  students: {
    student_id: string;
    student_name: string;
    student_code: string | null;
    grades: Record<string, number | null>;
  }[];
};

export type CombinedResultsData = {
  subject: { id: string; code: string; name: string };
  columns: ResultColumn[];
  sections: CombinedSectionView[];
};

export function computeExamMaxGrade(exam: {
  points_per_question: unknown;
  difficulty_mix: unknown;
}): number {
  const mix = exam.difficulty_mix as DifficultyMix;
  const total = (mix.easy ?? 0) + (mix.medium ?? 0) + (mix.hard ?? 0);
  return Number(exam.points_per_question) * total;
}

function hasEnded(exam: { end_time: Date }): boolean {
  return new Date() >= exam.end_time;
}

export async function checkExamResultAccess(
  auth: AuthPayload,
  exam: Exam,
): Promise<ResultAccess> {
  if (auth.role === 'student') {
    return { ok: false, status: 403, error: 'Students cannot view exam results' };
  }
  if (auth.role === 'admin') {
    return { ok: true };
  }

  // Authorisation is decided before the time gate, never after it. A viewer who may never
  // see these results has to get the same 403 whether the exam is running or over: checking
  // hasEnded first made the answer depend on the clock and let an unauthorised TA or a
  // non-owning doctor learn that the exam exists and is still open.
  if (auth.role === 'doctor') {
    if (exam.type === 'doctor_exam' && exam.owner_id !== auth.userId) {
      return { ok: false, status: 403, error: 'You do not own this exam' };
    }
    if (exam.type === 'ta_quiz' && !(await isDoctorOfSubject(auth.userId, exam.subject_id))) {
      return { ok: false, status: 403, error: 'You are not the doctor of this subject' };
    }
  } else if (auth.role === 'ta') {
    if (exam.type !== 'ta_quiz' || exam.owner_id !== auth.userId) {
      return { ok: false, status: 403, error: 'You can only view results for your own quizzes' };
    }
  } else {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (!hasEnded(exam)) {
    return { ok: false, status: 409, error: 'Results are available after the exam/quiz ends' };
  }

  return { ok: true };
}

async function getStudentSectionMap(
  subjectId: string,
  studentIds: string[],
): Promise<Map<string, { id: string; name: string; ta: { id: string; full_name: string } }>> {
  const map = new Map<string, { id: string; name: string; ta: { id: string; full_name: string } }>();
  if (studentIds.length === 0) return map;

  const memberships = await prisma.sectionMembership.findMany({
    where: { student_id: { in: studentIds }, section: { subject_id: subjectId } },
    include: {
      section: { include: { ta: { select: { id: true, full_name: true } } } },
    },
  });

  for (const m of memberships) {
    if (!map.has(m.student_id)) {
      map.set(m.student_id, {
        id: m.section.id,
        name: m.section.name,
        ta: { id: m.section.ta.id, full_name: m.section.ta.full_name },
      });
    }
  }
  return map;
}

export async function getExamResultRows(exam: Exam): Promise<ResultRow[]> {
  const eligibleIds = await getEligibleStudentIds(exam);
  if (eligibleIds.length === 0) return [];

  const [students, studentExams, sectionMap] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: eligibleIds } },
      select: { id: true, full_name: true, student_code: true },
    }),
    prisma.studentExam.findMany({
      where: { exam_id: exam.id, student_id: { in: eligibleIds } },
      select: { student_id: true, status: true, total_grade: true },
    }),
    getStudentSectionMap(exam.subject_id, eligibleIds),
  ]);

  const seMap = new Map(studentExams.map((se) => [se.student_id, se]));

  const rows: ResultRow[] = students.map((s) => {
    const se = seMap.get(s.id);
    const isGraded = se?.status === 'submitted' || se?.status === 'auto_submitted';
    return {
      student_id: s.id,
      student_name: s.full_name,
      student_code: s.student_code,
      section: sectionMap.get(s.id) ?? null,
      status: se?.status ?? 'not_started',
      grade: isGraded ? Number(se.total_grade ?? 0) : null,
    };
  });

  rows.sort((a, b) => a.student_name.localeCompare(b.student_name));
  return rows;
}

export async function buildCombinedResultsData(
  subject: { id: string; code: string; name: string },
  auth: AuthPayload,
): Promise<CombinedResultsData> {
  const now = new Date();
  const isTa = auth.role === 'ta';
  const isDoctor = auth.role === 'doctor';

  const sections = await prisma.section.findMany({
    where: isTa ? { subject_id: subject.id, ta_id: auth.userId } : { subject_id: subject.id },
    include: {
      ta: { select: { id: true, full_name: true } },
      memberships: {
        include: { student: { select: { id: true, full_name: true, student_code: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  let examRecords;
  if (isTa) {
    examRecords = await prisma.exam.findMany({
      where: {
        subject_id: subject.id,
        type: 'ta_quiz',
        owner_id: auth.userId,
        end_time: { lte: now },
      },
      include: { owner: { select: { id: true, full_name: true } } },
      orderBy: { start_time: 'asc' },
    });
  } else {
    const doctorWhere = isDoctor
      ? {
          subject_id: subject.id,
          type: 'doctor_exam' as const,
          owner_id: auth.userId,
          end_time: { lte: now },
        }
      : { subject_id: subject.id, type: 'doctor_exam' as const, end_time: { lte: now } };

    const [doctorExams, quizzes] = await Promise.all([
      prisma.exam.findMany({
        where: doctorWhere,
        include: { owner: { select: { id: true, full_name: true } } },
        orderBy: { start_time: 'asc' },
      }),
      prisma.exam.findMany({
        where: { subject_id: subject.id, type: 'ta_quiz', end_time: { lte: now } },
        include: { owner: { select: { id: true, full_name: true } } },
        orderBy: { start_time: 'asc' },
      }),
    ]);
    examRecords = [...doctorExams, ...quizzes];
  }

  const columns: ResultColumn[] = examRecords.map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    max_grade: computeExamMaxGrade(e),
    owner: { id: e.owner.id, full_name: e.owner.full_name },
  }));

  const columnIds = columns.map((c) => c.id);
  const studentIds = sections.flatMap((s) => s.memberships.map((m) => m.student_id));

  const studentExams =
    columnIds.length && studentIds.length
      ? await prisma.studentExam.findMany({
          where: { exam_id: { in: columnIds }, student_id: { in: studentIds } },
          select: { exam_id: true, student_id: true, status: true, total_grade: true },
        })
      : [];

  const gradeMap = new Map<string, number | null>();
  for (const se of studentExams) {
    const isGraded = se.status === 'submitted' || se.status === 'auto_submitted';
    gradeMap.set(`${se.exam_id}:${se.student_id}`, isGraded ? Number(se.total_grade ?? 0) : null);
  }

  const sectionViews: CombinedSectionView[] = sections.map((section) => ({
    section: { id: section.id, name: section.name },
    ta: { id: section.ta.id, full_name: section.ta.full_name },
    students: section.memberships
      .map((m) => ({
        student_id: m.student.id,
        student_name: m.student.full_name,
        student_code: m.student.student_code,
        grades: Object.fromEntries(
          columns.map((c) => [c.id, gradeMap.get(`${c.id}:${m.student.id}`) ?? null]),
        ),
      }))
      .sort((a, b) => a.student_name.localeCompare(b.student_name)),
  }));

  return { subject, columns, sections: sectionViews };
}
