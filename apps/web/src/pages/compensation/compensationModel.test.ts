import { describe, it, expect } from 'vitest';
import {
  MAX_POINTS,
  MIN_REASON_LENGTH,
  auditRows,
  buildCompensationPayload,
  canCompensate,
  compensationOutcome,
  cohortWarning,
  parsePoints,
  pickableQuestions,
  pointsRefusal,
  pointsValue,
  validateCompensation,
  type CompensationDraft,
} from './compensationModel';
import type { AuditRow, LiveAttempt } from './compensationTypes';

function liveAttempt(overrides: Partial<LiveAttempt> = {}): LiveAttempt {
  return {
    student_exam_id: 'se-1',
    student: { id: 'stu-1', full_name: 'Live student', student_code: 'S81342' },
    status: 'submitted',
    answered_count: 3,
    deadline_at: null,
    has_active_session: false,
    ...overrides,
  };
}

const SUBMITTED = [liveAttempt()];

function draft(overrides: Partial<CompensationDraft> = {}): CompensationDraft {
  return {
    questionId: '11111111-1111-4111-8111-111111111111',
    adjustmentType: 'full_credit',
    points: '',
    scope: 'all',
    studentExamIds: [],
    reason: 'Faulty stem',
    ...overrides,
  };
}

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'a-1',
    adjustment_type: 'set_points',
    reason: 'Ambiguous wording',
    previous_points: '1.25',
    new_points: '2.00',
    created_at: '2026-09-29T10:00:00.000Z',
    student_exam_question: {
      id: 'seq-1',
      question_id: 'q-1',
      text: 'Live easy question',
      student_exam: {
        id: 'se-1',
        student: { id: 'stu-1', full_name: 'Live student', student_code: 'S81342' },
      },
    },
    actor: { id: 'doc-1', full_name: 'Live doctor' },
    ...overrides,
  };
}

describe('parsePoints', () => {
  it('treats an empty or blank field as absent rather than zero', () => {
    expect(parsePoints('')).toBeNull();
    expect(parsePoints('   ')).toBeNull();
  });

  it('parses plain decimals', () => {
    expect(parsePoints('0')).toBe(0);
    expect(parsePoints('2')).toBe(2);
    expect(parsePoints('1.5')).toBe(1.5);
    expect(parsePoints('9999.99')).toBe(MAX_POINTS);
  });

  it('rejects a value past the storage ceiling', () => {
    expect(parsePoints('10000')).toBeNull();
    expect(parsePoints('99999.99')).toBeNull();
  });

  it('rejects more than two decimal places, which the column would silently round', () => {
    expect(parsePoints('1.005')).toBeNull();
    expect(parsePoints('0.001')).toBeNull();
  });

  it('rejects negative values and non-numeric text', () => {
    expect(parsePoints('-1')).toBeNull();
    expect(parsePoints('abc')).toBeNull();
    expect(parsePoints('1,5')).toBeNull();
    expect(parsePoints('1e3')).toBeNull();
  });

  it('rejects a two-decimal value the server would refuse, rather than letting it 400 later', () => {
    // 0.29 * 100 === 28.999999999999996, so Number.isInteger fails and the server's
    // own refine refuses it. 13% of all legal two-decimal values behave this way.
    expect(parsePoints('0.29')).toBeNull();
    expect(parsePoints('0.07')).toBeNull();
    expect(parsePoints('1.09')).toBeNull();
  });
});

describe('pointsRefusal', () => {
  it('says nothing about a value the server accepts', () => {
    expect(pointsRefusal('')).not.toBeNull();
    expect(pointsRefusal('0')).toBeNull();
    expect(pointsRefusal('2')).toBeNull();
    expect(pointsRefusal('0.3')).toBeNull();
    expect(pointsRefusal('9999.99')).toBeNull();
  });

  it('names the real reason rather than blaming a decimal count the value does not have', () => {
    const message = pointsRefusal('0.29');
    expect(message).toContain('0.29');
    expect(message).not.toContain('at most 2 decimal places');
  });

  it('suggests a nearby value the server will accept, and only one it has checked', () => {
    const message = pointsRefusal('0.29');
    expect(message).toContain('0.3');
    expect(parsePoints('0.3')).toBe(0.3);
  });

  it('blames the decimal count when that is genuinely the problem', () => {
    expect(pointsRefusal('1.005')).toContain('at most 2 decimal places');
  });

  it('distinguishes empty, non-numeric, negative and over-the-ceiling', () => {
    expect(pointsRefusal('')).toContain('required');
    expect(pointsRefusal('abc')).toContain('number');
    expect(pointsRefusal('-1')).toContain('negative');
    expect(pointsRefusal('10000')).toContain('9999.99');
  });
});

describe('validateCompensation', () => {
  it('accepts a complete full_credit draft for the whole cohort', () => {
    expect(validateCompensation(draft())).toEqual([]);
  });

  it('requires a question', () => {
    const problems = validateCompensation(draft({ questionId: '' }));
    expect(problems.join(' ')).toContain('question');
  });

  it('refuses to pass when no scope has been chosen', () => {
    const problems = validateCompensation(draft({ scope: '' }));
    expect(problems.join(' ')).toContain('Choose who');
  });

  it('requires at least one student when the scope is selected students', () => {
    const problems = validateCompensation(draft({ scope: 'selected', studentExamIds: [] }));
    expect(problems.join(' ')).toContain('at least one student');
  });

  it('accepts a selected-student scope with ids present', () => {
    expect(validateCompensation(draft({ scope: 'selected', studentExamIds: ['se-1'] }))).toEqual([]);
  });

  it('requires a reason of at least three characters after trimming', () => {
    expect(validateCompensation(draft({ reason: 'ab' })).join(' ')).toContain('reason');
    expect(validateCompensation(draft({ reason: '   ' })).join(' ')).toContain('reason');
    expect(validateCompensation(draft({ reason: 'abc' }))).toEqual([]);
  });

  it('keeps the minimum in one place with the server bound', () => {
    expect(MIN_REASON_LENGTH).toBe(3);
  });

  it('requires points for set_points', () => {
    expect(validateCompensation(draft({ adjustmentType: 'set_points', points: '' })).join(' ')).toContain(
      'points',
    );
    expect(validateCompensation(draft({ adjustmentType: 'set_points', points: 'abc' })).join(' ')).toContain(
      'points',
    );
  });

  it('rejects points the server would refuse or round', () => {
    expect(
      validateCompensation(draft({ adjustmentType: 'set_points', points: '10000' })).join(' '),
    ).toContain('points');
    expect(
      validateCompensation(draft({ adjustmentType: 'set_points', points: '1.005' })).join(' '),
    ).toContain('points');
  });

  it('allows zero points, which the server treats as valid', () => {
    expect(validateCompensation(draft({ adjustmentType: 'set_points', points: '0' }))).toEqual([]);
  });

  it('ignores points for full_credit, where the server derives the value itself', () => {
    expect(validateCompensation(draft({ adjustmentType: 'full_credit', points: '10000' }))).toEqual([]);
  });

  it('collects every problem at once instead of stopping at the first', () => {
    const problems = validateCompensation(
      draft({ questionId: '', scope: '', reason: '', adjustmentType: 'set_points', points: '' }),
    );
    expect(problems.length).toBe(4);
  });
});

describe('buildCompensationPayload', () => {
  it('omits student_exam_ids entirely for the whole cohort, rather than sending an empty list', () => {
    const payload = buildCompensationPayload(draft());
    expect(payload).not.toBeNull();
    expect(payload && 'student_exam_ids' in payload).toBe(false);
  });

  it('omits student_exam_ids even when the draft still holds stale ids', () => {
    const payload = buildCompensationPayload(draft({ scope: 'all', studentExamIds: ['se-9'] }));
    expect(payload && 'student_exam_ids' in payload).toBe(false);
  });

  it('sends the chosen ids when the scope is selected students', () => {
    const payload = buildCompensationPayload(draft({ scope: 'selected', studentExamIds: ['se-1', 'se-2'] }));
    expect(payload?.student_exam_ids).toEqual(['se-1', 'se-2']);
  });

  it('omits points for full_credit, where the server uses the exam points_per_question', () => {
    const payload = buildCompensationPayload(draft({ adjustmentType: 'full_credit', points: '3' }));
    expect(payload && 'points' in payload).toBe(false);
  });

  it('sends points as a number, not the raw text from the input', () => {
    const payload = buildCompensationPayload(draft({ adjustmentType: 'set_points', points: '1.50' }));
    expect(payload?.points).toBe(1.5);
    expect(typeof payload?.points).toBe('number');
  });

  it('maps the question id onto source_question_id', () => {
    const payload = buildCompensationPayload(draft());
    expect(payload?.source_question_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('trims the reason it sends', () => {
    const payload = buildCompensationPayload(draft({ reason: '  Faulty stem  ' }));
    expect(payload?.reason).toBe('Faulty stem');
  });

  it('refuses to build a payload from an invalid draft', () => {
    expect(buildCompensationPayload(draft({ scope: '' }))).toBeNull();
    expect(buildCompensationPayload(draft({ reason: '' }))).toBeNull();
  });
});

describe('compensationOutcome', () => {
  it('does not claim a recalculation happened when the server recorded nothing', () => {
    // Unreachable from the route, which always reports at least one row. The generic branch would
    // read "All 0 attempt total grades were recalculated straight away" — a success alert
    // asserting work that did not occur, which is worse than admitting the mismatch.
    const outcome = compensationOutcome({ adjustmentCount: 0, totalGradeRecalculated: 0 });
    expect(outcome.pending).toBe(0);
    expect(outcome.detail).toContain('recorded no adjustment');
    expect(outcome.detail).not.toContain('0 attempt total');
  });

  it('reports a fully applied run without mentioning anything pending', () => {
    const outcome = compensationOutcome({ adjustmentCount: 5, totalGradeRecalculated: 5 });
    expect(outcome.pending).toBe(0);
    expect(outcome.detail).not.toContain('pending');
  });

  it('does not read as a fraction of a noun when there is exactly one attempt', () => {
    // Shipped once as "1 of 1 attempt total recalculated straight away" because nothing pinned
    // this wording; it was caught by running a real compensation and reading the sentence.
    expect(compensationOutcome({ adjustmentCount: 1, totalGradeRecalculated: 1 }).detail).toBe(
      "1 attempt's total grade was recalculated straight away."
    );
  });

  it('spells the count out in full when every one of several was applied', () => {
    expect(compensationOutcome({ adjustmentCount: 4, totalGradeRecalculated: 4 }).detail).toContain(
      'All 4 attempt total grades'
    );
  });

  it('leads with zero recalculated when every attempt is still in progress', () => {
    const outcome = compensationOutcome({ adjustmentCount: 4, totalGradeRecalculated: 0 });
    expect(outcome.pending).toBe(4);
    expect(outcome.detail).toContain('0 of 4');
    // A run that recalculates nothing is correct, not a failure, so the copy has to name the
    // submission that will apply it rather than leaving the actor to wonder.
    expect(outcome.detail).toContain('4 attempts are still in progress');
    expect(outcome.detail).toContain('when those students submit');
  });

  it('counts the difference as pending on a partial run', () => {
    const outcome = compensationOutcome({ adjustmentCount: 3, totalGradeRecalculated: 2 });
    expect(outcome.pending).toBe(1);
    expect(outcome.detail).toContain('2 of 3');
    expect(outcome.detail).toContain('1 attempt is still in progress');
    expect(outcome.detail).toContain('when the student submits');
  });

  it('agrees in number with the attempt total, so the two figures always add up', () => {
    expect(compensationOutcome({ adjustmentCount: 5, totalGradeRecalculated: 2 }).detail).toContain(
      '3 attempts are still in progress',
    );
    expect(compensationOutcome({ adjustmentCount: 1, totalGradeRecalculated: 0 }).detail).toContain(
      '1 attempt is still in progress',
    );
  });

  it('never reports a negative number of pending adjustments if the server is inconsistent', () => {
    expect(compensationOutcome({ adjustmentCount: 2, totalGradeRecalculated: 5 }).pending).toBe(0);
  });
});

describe('cohortWarning', () => {
  it('does not report an unknown attempt count as zero', () => {
    // The attempt list is loaded by a second, non-fatal request, so it can fail on its own.
    // Rendering its empty array as a count told the user "0 attempts are on file" in the one
    // sentence whose job is to stop an accidental cohort-wide write, and "0" reads as
    // "this will do nothing" — the most permissive misreading of a destructive action.
    const warning = cohortWarning('Live hard question', null);
    expect(warning).toContain('could not be loaded');
    expect(warning).toContain('unknown');
    expect(warning).not.toMatch(/\b0 attempts\b/);
    expect(warning).not.toMatch(/— \d+ attempt/);
  });

  it('still says zero when zero is the truth', () => {
    // An unknown count and a genuinely empty exam are different facts and must not read alike.
    expect(cohortWarning('Live hard question', 0)).toContain('0 attempts are on file');
  });


  it('names the question and the attempts on file', () => {
    const warning = cohortWarning('Live easy question', 12);
    expect(warning).toContain('Live easy question');
    expect(warning).toContain('12');
  });
});

describe('canCompensate', () => {
  it('allows only an approved exam, which is the server rule', () => {
    expect(canCompensate('approved').allowed).toBe(true);
    expect(canCompensate('draft').allowed).toBe(false);
    expect(canCompensate('pending_approval').allowed).toBe(false);
    expect(canCompensate('rejected').allowed).toBe(false);
    expect(canCompensate('locked').allowed).toBe(false);
    expect(canCompensate('closed').allowed).toBe(false);
  });

  it('explains the refusal in the server wording', () => {
    expect(canCompensate('pending_approval').reason).toContain('approved');
  });

  it('gives an allowed exam no reason text, so the form is not gated by a stale message', () => {
    expect(canCompensate('approved').reason).toBe('');
  });
});

describe('pointsValue', () => {
  it('reads a Prisma Decimal JSON string into a number', () => {
    expect(pointsValue('1.25')).toBe(1.25);
    expect(pointsValue(2)).toBe(2);
  });

  it('falls back to zero rather than producing NaN', () => {
    expect(pointsValue('not a number')).toBe(0);
    expect(pointsValue(null)).toBe(0);
  });
});

describe('auditRows', () => {
  it('converts the Decimal strings Prisma sends for previous and new points', () => {
    const rows = auditRows([auditRow()], SUBMITTED);
    expect(rows[0]?.previous_points).toBe(1.25);
    expect(rows[0]?.new_points).toBe(2);
  });

  it('computes the signed change so a reduction is not shown as a gain', () => {
    expect(auditRows([auditRow()], SUBMITTED)[0]?.delta).toBeCloseTo(0.75, 6);
    expect(
      auditRows([auditRow({ previous_points: '2', new_points: '1.5' })], SUBMITTED)[0]?.delta,
    ).toBeCloseTo(-0.5, 6);
    expect(
      auditRows([auditRow({ previous_points: '1.5', new_points: '1.5' })], SUBMITTED)[0]?.delta,
    ).toBeCloseTo(0, 6);
  });

  it('surfaces who, which student, which question and why', () => {
    const [row] = auditRows([auditRow()], SUBMITTED);
    expect(row?.actor_name).toBe('Live doctor');
    expect(row?.student_name).toBe('Live student');
    expect(row?.student_code).toBe('S81342');
    expect(row?.question_text).toBe('Live easy question');
    expect(row?.reason).toBe('Ambiguous wording');
  });

  it('handles a missing student code without printing undefined', () => {
    const row = auditRow();
    row.student_exam_question.student_exam.student.student_code = null;
    expect(auditRows([row], SUBMITTED)[0]?.student_code).toBeNull();
  });

  it('returns an empty list for an absent adjustments array', () => {
    expect(auditRows(null, SUBMITTED)).toEqual([]);
    expect(auditRows([], SUBMITTED)).toEqual([]);
  });

  it('marks a row pending when its attempt has not been graded yet', () => {
    // The service records previous_points 0 and new_points 2 for a full_credit on an in-progress
    // attempt and changes nothing, so a row rendered without this tag asserts a grade change that
    // has not happened. The audit trail is the durable artefact, so this cannot live only in the
    // transient success message.
    const inProgress = [liveAttempt({ student_exam_id: 'se-1', status: 'in_progress' })];
    expect(auditRows([auditRow()], inProgress)[0]?.pending).toBe(true);
  });

  it('does not mark a row pending once the attempt is graded', () => {
    expect(auditRows([auditRow()], SUBMITTED)[0]?.pending).toBe(false);
    expect(
      auditRows([auditRow()], [liveAttempt({ student_exam_id: 'se-1', status: 'auto_submitted' })])[0]
        ?.pending,
    ).toBe(false);
  });

  it('reports the distinction as unknown, not as applied, when the attempt list is missing', () => {
    // Omitting the tag would read as "this grade already moved", which is the same false
    // statement in the opposite direction. null is its own state and the page says so once.
    expect(auditRows([auditRow()], null)[0]?.pending).toBeNull();
  });

  it('marks a not_started attempt pending too, since nothing has been graded at all', () => {
    expect(
      auditRows([auditRow()], [liveAttempt({ student_exam_id: 'se-1', status: 'not_started' })])[0]
        ?.pending,
    ).toBe(true);
  });

  it('keeps the order the server sent, which is newest first', () => {
    const rows = auditRows([auditRow({ id: 'new' }), auditRow({ id: 'old' })], SUBMITTED);
    expect(rows.map((row) => row.id)).toEqual(['new', 'old']);
  });
});

describe('pickableQuestions', () => {
  const pool = [
    { question: { id: 'q-easy', text: 'Live easy question' } },
    { question: { id: 'q-medium', text: 'Live medium question' } },
  ];

  it('offers every question in the exam pool, in the order the server sent them', () => {
    expect(pickableQuestions(pool, [])).toEqual([
      { id: 'q-easy', text: 'Live easy question' },
      { id: 'q-medium', text: 'Live medium question' },
    ]);
  });

  it('survives a missing pool, which is what reading the wrong level of GET /exams/:id gives', () => {
    // The browser hit this: `exam.pool_questions` was undefined because the route answers
    // `{ exam }`, and a `.map` on it threw inside a useMemo with no test and no type error.
    expect(pickableQuestions(undefined, [])).toEqual([]);
    expect(pickableQuestions(null, [])).toEqual([]);
  });

  it('survives a pool entry with no question, rather than reporting a blank id', () => {
    expect(pickableQuestions([{ question: null }, {}], [])).toEqual([]);
  });

  it('adds a question that left the pool but still carries an adjustment, so a correction is re-runnable', () => {
    const rows = pickableQuestions(pool, [auditRow()]);
    expect(rows.map((row) => row.id)).toEqual(['q-easy', 'q-medium', 'q-1']);
    expect(rows[2]).toEqual({ id: 'q-1', text: 'Live easy question' });
  });

  it('does not list a question twice when the trail names one that is also in the pool', () => {
    const rows = pickableQuestions(
      [{ question: { id: 'q-1', text: 'Live easy question' } }],
      [auditRow()]
    );
    expect(rows.map((row) => row.id)).toEqual(['q-1']);
    expect(rows[0]?.text).toBe('Live easy question');
  });

  it('still returns the trail questions when the pool is unavailable', () => {
    expect(pickableQuestions(undefined, [auditRow()])).toEqual([
      { id: 'q-1', text: 'Live easy question' },
    ]);
  });

  it('survives an absent adjustments array', () => {
    expect(pickableQuestions(pool, null)).toHaveLength(2);
    expect(pickableQuestions(pool, undefined)).toHaveLength(2);
  });
});
