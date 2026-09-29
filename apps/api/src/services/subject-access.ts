import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Role } from '@exam/shared';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function buildScopedSubjectWhere(role: Role, userId: string): Prisma.SubjectWhereInput {
  if (role === 'admin') return {};
  if (role === 'doctor') return { doctor_assignments: { some: { doctor_id: userId } } };
  if (role === 'ta') return { sections: { some: { ta_id: userId } } };
  return { id: NIL_UUID };
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
  return { ...base, id: NIL_UUID };
}

/**
 * The subject id a staff member is allowed to read a roster for, or the nil UUID when
 * they are not.
 *
 * The two roster routes used to disagree: /subjects/:id/sections narrowed a doctor to
 * their assigned subjects, while /subjects/:id/students narrowed only a TA, so a doctor
 * with zero doctor_assignments got an empty section list and the full name, student code
 * and section of every enrolled student. A correct sibling is evidence the pattern is
 * known, not that it was applied, so both routes now ask this one function.
 *
 * A gate rather than a where-filter, because a User row cannot be filtered by the
 * caller's own doctor assignment: DoctorAssignment hangs off the doctor's User, not off
 * the student's. Failing closed with the nil UUID matches the idiom already used in
 * buildScopedSubjectWhere and buildScopedSectionWhere, and answering 200 with [] rather
 * than 403 keeps the two siblings byte-identical instead of inventing a second shape.
 */
export async function visibleRosterSubjectId(
  role: Role,
  userId: string,
  subjectId: string,
): Promise<string> {
  if (role === 'admin') return subjectId;
  if (role === 'doctor') return (await isDoctorOfSubject(userId, subjectId)) ? subjectId : NIL_UUID;
  if (role === 'ta') return (await taTeachesSection(userId, subjectId)) ? subjectId : NIL_UUID;
  return NIL_UUID;
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