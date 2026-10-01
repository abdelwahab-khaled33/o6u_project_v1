/**
 * Logic for the administrator's doctor-to-subject editor.
 *
 * The route decides what is legal; this file only decides what the screen is allowed to claim.
 * Every rule below exists because the server does not make it for us, and one of them exists
 * because the server has no way to make it at all.
 */

/** Exactly the body PUT /admin/doctor-assignments accepts. Both keys are required. */
export type AssignmentBody = { doctor_id: string; subject_ids: string[] };

/**
 * Returns null rather than a body whenever there is no doctor to assign, so a caller that
 * forgets to gate cannot send a non-uuid and earn a 400 for something the UI already knew.
 *
 * Three details are load-bearing rather than tidy:
 *
 * 1. `subject_ids` is emitted even when it is empty. The route's zod makes the key REQUIRED, so
 *    omitting it is a 400 reading "you sent nothing" — not "clear every subject". The empty
 *    array is the only way to say that, and it is a real action an administrator needs.
 * 2. The ids are sorted. The route echoes the request order straight back as `subject_ids`, so an
 *    unsorted body would make the list in the success sentence depend on the order the boxes were
 *    clicked. Sorting makes that sentence a function of the selection and nothing else.
 * 3. Repeats are dropped. The route deduplicates too, but the client's own count should not be
 *    able to overstate the change before the server ever answers.
 *
 * `Array.prototype.toSorted` is not available in the runtime this build targets, so the copy is
 * explicit.
 */
export function buildAssignmentBody(doctorId: string, selectedSubjectIds: readonly string[]): AssignmentBody | null {
  const doctor = doctorId.trim();
  if (doctor === '') return null;

  return { doctor_id: doctor, subject_ids: [...new Set(selectedSubjectIds)].sort() };
}

/** What the screen currently knows. Each flag is a separate fact because each has its own
 *  request, and "that request failed" is not "there is nothing there". */
export type EditState = {
  doctorId: string;
  /** GET /admin/subjects succeeded. */
  subjectsLoaded: boolean;
  /** GET /admin/doctor-assignments/:doctorId succeeded for the selected doctor. */
  assignmentsLoaded: boolean;
};

/**
 * The gate on the save control. A doctor has to be selected, and both lists have to be known.
 *
 * There is deliberately no requirement for any subject to be ticked. An empty selection is the
 * documented way to clear a doctor of every subject, so refusing to save it would make the one
 * action that removes assignments unreachable from the screen.
 *
 * The two load flags are the whole point of this function. An empty picker with an enabled save
 * button is not a display state, it is a loaded gun: the save would send `subject_ids: []`, which
 * the route accepts as "clear every subject", so one failed read becomes a silent clear of
 * everything that doctor teaches. Both flags exist for that reason and neither can be derived
 * from the length of the list it governs — `0` and "unknown" render the same and mean opposite
 * things. The second flag was added after a live browser pass showed the hazard happening: the
 * error was on screen, plainly, and the enabled button sat underneath it. An error message is
 * not a guard.
 */
export function canSave(state: EditState): boolean {
  return state.doctorId.trim() !== '' && state.subjectsLoaded && state.assignmentsLoaded;
}

/**
 * Full names are not unique and two doctors can be listed side by side, so the username travels
 * with the name. A blank name falls back to the bare username rather than rendering an option
 * that starts with a stray parenthesis.
 */
export function doctorOptionLabel(user: { username: string; full_name: string }): string {
  const name = user.full_name.trim();
  return name === '' ? `(${user.username})` : `${name} (${user.username})`;
}

/**
 * The success sentence, composed in one place so the branches cannot drift apart.
 *
 * `removed` is only ever mentioned when it is greater than zero. A zero is true on an unchanged
 * save and on a first-time assignment alike, so printing it makes a no-op read as a result —
 * and "Saved 0 subjects" reads as a failure, in the one sentence the administrator reads to find
 * out whether anything happened. `saved` is what the server returned, not what was requested, so
 * the sentence reports the state that actually exists.
 *
 * The wording is written out per count rather than assembled from a plural helper: the verb has
 * to agree with the number ("1 subject is assigned" / "2 subjects are assigned"), so a helper
 * that only swaps the noun would leave half the agreement to the caller.
 */
export function saveNotice(removedAssignments: number, savedSubjectIds: readonly string[]): string {
  const saved = savedSubjectIds.length;
  const removal =
    removedAssignments > 0
      ? ` ${removedAssignments} previous assignment${removedAssignments === 1 ? ' was' : 's were'} removed.`
      : '';

  if (saved === 0) {
    return `This doctor is no longer assigned to any subject.${removal} Nothing else about their account changed.`;
  }

  const listed = `${saved} subject${saved === 1 ? ' is' : 's are'} assigned to this doctor.`;
  return `${listed}${removal}`;
}

/**
 * Which assignment editor the Users detail panel owes an account. The enrollment card covers
 * students; this covers doctors. Every other role gets nothing from this card — an admin or a
 * TA has no subject assignment to edit, and rendering them an empty picker would read as a
 * claim about their teaching rather than as the absence of one.
 */
export type UserAssignmentSection = 'doctor-subjects' | 'ta-sections' | 'student-enrollments' | 'none';

export function assignmentSectionForRole(role: string): UserAssignmentSection {
  if (role === 'doctor') return 'doctor-subjects';
  if (role === 'ta') return 'ta-sections';
  if (role === 'student') return 'student-enrollments';
  return 'none';
}

/**
 * The consequences line, stated before the boxes rather than after the save, because the decision
 * being made here is destructive in a way the UI gives no other hint of.
 *
 * It is static text, and that is a deliberate limit rather than an omission. There is no route
 * that reports how many doctors each subject has — `GET /admin/doctor-assignments/:doctorId` is
 * the only read, and there is no GET without a `:doctorId` — so this screen cannot know whether
 * unticking a box would leave a subject with nobody able to run its question bank. Naming the
 * risk in general terms is honest; counting it per subject would require inventing an endpoint,
 * or worse, guessing from the one doctor currently loaded.
 */
export const ASSIGNMENT_CONSEQUENCE =
  'Assigning a subject is a permission, not data. Removing an assignment deletes no exam and no question: the doctor ' +
  'loses access to that subject\'s question bank and sees fewer subjects in their lists, while their existing exams remain ' +
  'their own. Clearing a subject from its last doctor leaves nobody able to manage that subject\'s question bank, so check ' +
  'who else is assigned to it before you empty it.';