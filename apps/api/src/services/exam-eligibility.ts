import { prisma } from '../lib/prisma.js';
import type { Exam, Prisma } from '@prisma/client';

type EligibilityClient = Pick<Prisma.TransactionClient, 'enrollment' | 'examTargetSection' | 'sectionMembership' | 'examTargetStudent'>;

export async function getEligibleStudentIds(
  exam: Exam,
  client: EligibilityClient = prisma,
): Promise<string[]> {
  if (exam.target_scope === 'subject') {
    const enrollments = await client.enrollment.findMany({
      where: { subject_id: exam.subject_id },
      select: { student_id: true },
    });
    return enrollments.map((e) => e.student_id);
  }

  if (exam.target_scope === 'sections') {
    const targets = await client.examTargetSection.findMany({
      where: { exam_id: exam.id },
      select: { section_id: true },
    });
    const sectionIds = targets.map((t) => t.section_id);
    if (sectionIds.length === 0) return [];
    const memberships = await client.sectionMembership.findMany({
      where: { section_id: { in: sectionIds } },
      select: { student_id: true },
    });
    return [...new Set(memberships.map((m) => m.student_id))];
  }

  const targets = await client.examTargetStudent.findMany({
    where: { exam_id: exam.id },
    select: { student_id: true },
  });
  return targets.map((t) => t.student_id);
}

export async function isStudentEligibleForExam(
  exam: Exam,
  studentId: string,
): Promise<boolean> {
  const enrolled = await prisma.enrollment.count({
    where: { student_id: studentId, subject_id: exam.subject_id },
  });
  if (enrolled === 0) return false;

  if (exam.target_scope === 'subject') return true;

  if (exam.target_scope === 'sections') {
    const count = await prisma.sectionMembership.count({
      where: {
        student_id: studentId,
        section: { exam_targets: { some: { exam_id: exam.id } } },
      },
    });
    return count > 0;
  }

  const count = await prisma.examTargetStudent.count({
    where: { exam_id: exam.id, student_id: studentId },
  });
  return count > 0;
}
