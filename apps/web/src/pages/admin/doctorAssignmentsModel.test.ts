import { describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_CONSEQUENCE,
  buildAssignmentBody,
  canSave,
  doctorOptionLabel,
  saveNotice,
  type AssignmentBody,
} from './doctorAssignmentsModel';

const DOC_A = '11111111-1111-1111-1111-111111111111';
const SUB_1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const SUB_2 = 'aaaaaaaa-2222-2222-2222-222222222222';
const SUB_3 = 'aaaaaaaa-3333-3333-3333-333333333333';

describe('buildAssignmentBody', () => {
  it('sends the doctor and every selected subject', () => {
    expect(buildAssignmentBody(DOC_A, [SUB_1, SUB_2])).toEqual({
      doctor_id: DOC_A,
      subject_ids: [SUB_1, SUB_2],
    });
  });

  // The route's zod makes subject_ids REQUIRED. Omitting the key is a 400
  // ("doctor_id and subject_ids are required") and means "you sent nothing", not
  // "clear everything" — so the empty case has to be spelled as [].
  it('sends an empty array, never an omitted key, when nothing is selected', () => {
    const body = buildAssignmentBody(DOC_A, []);

    expect(body).not.toBeNull();
    expect(body).toEqual({ doctor_id: DOC_A, subject_ids: [] });
    expect(Object.keys(body as AssignmentBody)).toContain('subject_ids');
  });

  it('refuses to build a body with no doctor, instead of sending one the server rejects', () => {
    expect(buildAssignmentBody('', [SUB_1])).toBeNull();
    expect(buildAssignmentBody('   ', [SUB_1])).toBeNull();
  });

  // The route echoes the request order back as `subject_ids`, so an unsorted body would make
  // the saved state in the success sentence depend on the order the administrator happened to
  // click the boxes. Sorting makes the sentence a function of the selection alone.
  it('sorts the subject ids, so click order cannot change what was saved', () => {
    expect(buildAssignmentBody(DOC_A, [SUB_3, SUB_1, SUB_2])?.subject_ids).toEqual([SUB_1, SUB_2, SUB_3]);
    expect(buildAssignmentBody(DOC_A, [SUB_2, SUB_1])?.subject_ids).toEqual([SUB_1, SUB_2]);
  });

  it('drops a repeated subject, because the count would otherwise overstate the change', () => {
    expect(buildAssignmentBody(DOC_A, [SUB_2, SUB_1, SUB_2])?.subject_ids).toEqual([SUB_1, SUB_2]);
  });
});

describe('canSave', () => {
  const KNOWN = { doctorId: DOC_A, subjectsLoaded: true, assignmentsLoaded: true };

  it('needs a doctor selected', () => {
    expect(canSave({ ...KNOWN, doctorId: '' })).toBe(false);
    expect(canSave({ ...KNOWN, doctorId: '   ' })).toBe(false);
  });

  // The one thing submit is NOT gated on. An empty selection is the deliberate "clear every
  // subject" action, so refusing to save it would make the only way to empty a doctor unreachable.
  it('does not require any subject, because empty is a legal and meaningful save', () => {
    expect(canSave(KNOWN)).toBe(true);
  });

  // subjectsLoaded=false means the catalogue request failed, which is NOT the same as there
  // being no subjects. If that were coerced to an empty list, the screen would render no boxes
  // for a doctor who has assignments and then send subject_ids: [] on the next save — turning a
  // failed read into a clear of everything that doctor teaches.
  it('refuses to save when the subject catalogue is unknown, rather than writing a blind clear', () => {
    expect(canSave({ ...KNOWN, subjectsLoaded: false })).toBe(false);
  });

  // assignmentsLoaded=false is the same trap one step later, and this case was found in a live
  // browser pass rather than by reading the code. A failed assignment read had cleared the ticked
  // set, so the screen showed an empty picker and an ENABLED save button right beside the error
  // that explained why it was empty. One click, and the save that looked harmless was the one
  // wiping the doctor's whole teaching load. The error being on screen is not a guard: it is a
  // sentence an administrator reads past.
  it('refuses to save when the assignment read failed, rather than writing a blind clear', () => {
    expect(canSave({ ...KNOWN, assignmentsLoaded: false })).toBe(false);
  });

  // The control beside the two refusals above. Without it, a canSave that simply returned false
  // would pass this whole block and leave the editor unusable.
  it('allows a save once the doctor, the catalogue and the assignment are all known', () => {
    expect(canSave({ doctorId: DOC_A, subjectsLoaded: true, assignmentsLoaded: true })).toBe(true);
  });
});

describe('doctorOptionLabel', () => {
  it('carries the username as well as the name, because two doctors can share a name', () => {
    expect(doctorOptionLabel({ username: 'live_doc1', full_name: 'Sara Ahmed' })).toBe('Sara Ahmed (live_doc1)');
  });

  it('falls back to the username when there is no name to show', () => {
    expect(doctorOptionLabel({ username: 'live_doc2', full_name: '' })).toBe('(live_doc2)');
    expect(doctorOptionLabel({ username: 'live_doc2', full_name: '   ' })).toBe('(live_doc2)');
  });
});

describe('saveNotice', () => {
  // The Screen 1 lesson, applied again: a count of 0 is true on an unchanged save and on a
  // first-time assignment, and printing it makes a no-op read as a result. Say the count only
  // when something was actually removed.
  it('says nothing about removals when nothing was removed', () => {
    const notice = saveNotice(0, [SUB_1, SUB_2]);

    expect(notice).toContain('2 subjects');
    expect(notice).not.toContain('0');
    expect(notice).not.toMatch(/remov/i);
  });

  it('reports the removal count when subjects were taken away', () => {
    const notice = saveNotice(2, [SUB_1]);

    expect(notice).toContain('1 subject');
    expect(notice).toContain('2');
    expect(notice).toMatch(/remov/i);
  });

  // "Saved 0 subjects" is the phrase this guard exists to prevent: it reads as a failure and as
  // a claim that the screen could not save anything, when in fact clearing a doctor is the
  // request that did the work.
  it('describes an emptied doctor without printing a zero', () => {
    const notice = saveNotice(3, []);

    expect(notice).not.toContain('0');
    expect(notice).toContain('no longer assigned to any subject');
    expect(notice).toContain('3');
  });

  it('describes an already-empty doctor without claiming a change happened', () => {
    const notice = saveNotice(0, []);

    expect(notice).not.toContain('0');
    expect(notice).toContain('no longer assigned to any subject');
    expect(notice).not.toMatch(/remov/i);
  });

  it('agrees its verb with the count', () => {
    expect(saveNotice(0, [SUB_1])).toContain('is assigned');
    expect(saveNotice(0, [SUB_1, SUB_2])).toContain('are assigned');
  });

  // The notice must report what the SERVER returned, not what was requested. If a request were
  // ever refused and this still rendered, the sentence would be a claim about a save that never
  // happened, which is the failure mode the re-read after every save exists to prevent.
  it('reads the saved subjects out of the list it is given rather than assuming a request', () => {
    expect(saveNotice(0, [])).not.toBe(saveNotice(0, [SUB_1]));
  });
});

describe('ASSIGNMENT_CONSEQUENCE', () => {
  // The copy is pinned rather than trusted: these are the five consequences an administrator is
  // about to act on, and losing one to a rewording would leave the screen making a promise the
  // screen does not keep.
  it.each([
    ['that an assignment is permissions rather than data', /permission/i],
    ['that removing an assignment deletes no exam and no question', /(no exam|not delete|delet)/i],
    ['that the doctor loses the subject question bank', /question bank/i],
    ['that the doctor sees fewer subjects', /fewer subject/i],
    ['that the doctor keeps their existing exams', /(own|keep|still)/i],
    ['that emptying the last doctor of a subject leaves nobody to run its question bank', /last doctor|last one|nobody|no one/i],
  ])('states %s', (_claim, pattern) => {
    expect(ASSIGNMENT_CONSEQUENCE).toMatch(pattern);
  });
});