import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Role } from '@exam/shared';

export function buildScopedSubjectWhere(role: Role, userId: string): Prisma.SubjectWhereInput {
  if (role === 'admin') return {};
  if (role === 'doctor') return { doctor_assignments: { some: { doctor_id: userId } } };
  if (role === 'ta') return { sections: { some: { ta_id: userId } } };
  return { id: '00000000-0000-0000-0000-000000000000' };
}

export function buildScopedSectionWhere(
  role: Role,
  userId: string,
  subjectId?: string,
): Prisma.SectionWhereInput {
  const base = subjectId ? { subject_id: subjectId } : {};
  if (role === 'admin') return base;
  if (role === 'doctor') {
    return { ...base, subject: { doctor_assignments: { some: { doctor_id: userId } } } };
  }
  if (role === 'ta') return { ...base, ta_id: userId };
  return { ...base, id: '00000000-0000-0000-0000-000000000000' };
}

export async function canManageBank(
  userId: string,
  role: Role,
  subjectId: string,
): Promise<boolean> {
  // Deliberately no admin branch. Spec 9 grants question_bank.manage/.import/.export
  // to doctor and ta only, and the question-bank router is guarded by that key, so an
  // admin cannot reach this function at all today. Returning false keeps the dead path
  // fail-closed: relaxing the router guard must never silently hand an admin a
  // question bank that the matrix never granted. buildScopedSubjectWhere answers a
  // different question ("what may you list") and does return {} for admin, because
  // GET /subjects is a scoped read with no management key.
  if (role === 'doctor') {
    return (await prisma.doctorAssignment.count({
      where: { doctor_id: userId, subject_id: subjectId },
    })) > 0;
  }
  if (role === 'ta') {
    return (await prisma.section.count({
      where: { ta_id: userId, subject_id: subjectId },
    })) > 0;
  }
  return false;
}

export async function isDoctorOfSubject(doctorId: string, subjectId: string) {
  return (
    (await prisma.doctorAssignment.count({
      where: { doctor_id: doctorId, subject_id: subjectId },
    })) > 0
  );
}

export async function taTeachesSection(taId: string, subjectId: string) {
  return (
    (await prisma.section.count({
      where: { ta_id: taId, subject_id: subjectId },
    })) > 0
  );
}