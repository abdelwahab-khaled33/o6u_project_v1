/**
 * Logic for the subject/section step of the administrator's create-user form.
 *
 * POST /admin/users creates the account row only, so any teaching or enrollment the
 * administrator picks at create time becomes follow-up requests: one PUT
 * /admin/doctor-assignments for a doctor, one PUT /admin/enrollments per picked subject for
 * a student. This file only decides what the form is allowed to claim before it sends them.
 */

export type SubjectPick = { subjectId: string; sectionId: string };

export type EnrollmentBody = { student_id: string; subject_id: string; section_id: string };

/**
 * Every reason the current picks cannot be sent yet. An empty list means "sendable".
 *
 * Subjects are optional at create time — an empty pick list is valid and the account is
 * created bare, exactly like before. But a ticked subject without a section is not: the
 * enrollment route requires all three ids, so sending it would earn a 400 for something the
 * form already knew.
 */
export function createPicksProblems(
  picks: readonly SubjectPick[],
  subjects: ReadonlyArray<{ id: string; code: string }>,
  sections: ReadonlyArray<{ id: string; subject_id: string }>,
): string[] {
  const problems: string[] = [];
  for (const pick of picks) {
    const subject = subjects.find((candidate) => candidate.id === pick.subjectId);
    if (!subject) {
      problems.push('An unknown subject is selected. Reload the page and pick again.');
      continue;
    }
    if (pick.sectionId.trim() === '') {
      problems.push(`Choose a section for ${subject.code}: every enrolled subject needs one.`);
      continue;
    }
    const section = sections.find((candidate) => candidate.id === pick.sectionId);
    if (!section || section.subject_id !== subject.id) {
      problems.push(`The chosen section does not belong to ${subject.code}. Pick one of its own sections.`);
    }
  }
  return problems;
}

/**
 * One enrollment body per picked subject, or null when there is no student to enroll — the
 * caller only learns the id from the POST response, so a caller that forgets to wait for it
 * cannot send a non-uuid and earn a 400 for something the form already knew.
 */
export function buildEnrollmentBodies(studentId: string, picks: readonly SubjectPick[]): EnrollmentBody[] | null {
  const student = studentId.trim();
  if (student === '') return null;
  return picks.map((pick) => ({ student_id: student, subject_id: pick.subjectId, section_id: pick.sectionId }));
}
