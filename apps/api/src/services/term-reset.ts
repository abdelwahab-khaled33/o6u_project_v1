import { prisma } from '../lib/prisma.js';

export const RESET_CONFIRMATION_PHRASE = 'RESET TERM';

export const TERM_RESET_DELETE_ORDER = [
  'GradeAdjustment',
  'StudentExamQuestion',
  'StudentExam',
  'ExamTargetStudent',
  'ExamTargetSection',
  'ExamQuestion',
  'Exam',
  'Question',
  'SectionMembership',
  'Enrollment',
  'Section',
  'DoctorAssignment',
  'ExcelImportLog',
  'User',
] as const;

type TermResetTable = (typeof TERM_RESET_DELETE_ORDER)[number];
export type TermResetCounts = Record<TermResetTable, number>;

export function isValidResetConfirmation(input: string): boolean {
  return input.trim() === RESET_CONFIRMATION_PHRASE;
}

function toCounts(counts: number[]): TermResetCounts {
  return Object.fromEntries(
    TERM_RESET_DELETE_ORDER.map((table, index) => [table, counts[index]]),
  ) as TermResetCounts;
}

export async function getTermResetCounts(): Promise<TermResetCounts> {
  const counts = await Promise.all([
    prisma.gradeAdjustment.count(),
    prisma.studentExamQuestion.count(),
    prisma.studentExam.count(),
    prisma.examTargetStudent.count(),
    prisma.examTargetSection.count(),
    prisma.examQuestion.count(),
    prisma.exam.count(),
    prisma.question.count(),
    prisma.sectionMembership.count(),
    prisma.enrollment.count(),
    prisma.section.count(),
    prisma.doctorAssignment.count(),
    prisma.excelImportLog.count(),
    prisma.user.count({ where: { role: { not: 'admin' } } }),
  ]);

  return toCounts(counts);
}

export async function runTermReset(): Promise<TermResetCounts> {
  const deleted = await prisma.$transaction([
    prisma.gradeAdjustment.deleteMany(),
    prisma.studentExamQuestion.deleteMany(),
    prisma.studentExam.deleteMany(),
    prisma.examTargetStudent.deleteMany(),
    prisma.examTargetSection.deleteMany(),
    prisma.examQuestion.deleteMany(),
    prisma.exam.deleteMany(),
    prisma.question.deleteMany(),
    prisma.sectionMembership.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.section.deleteMany(),
    prisma.doctorAssignment.deleteMany(),
    prisma.excelImportLog.deleteMany(),
    prisma.user.deleteMany({ where: { role: { not: 'admin' } } }),
  ]);

  return toCounts(deleted.map((result) => result.count));
}
