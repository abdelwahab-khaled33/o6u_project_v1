import type { AdjustmentType } from '@exam/shared';
import type { AuditRow, CompensateBody, LiveAttempt, PickableQuestion } from './compensationTypes';

/** Mirrors MAX_ADJUSTMENT_POINTS in apps/api/src/routes/grade-adjustments.ts, which is the
 *  Decimal(6,2) storage ceiling rather than a policy limit. */
export const MAX_POINTS = 9999.99;
export const MIN_REASON_LENGTH = 3;
const MAX_DECIMAL_PLACES = 2;

export type Scope = 'all' | 'selected';

export type CompensationDraft = {
  questionId: string;
  adjustmentType: AdjustmentType;
  points: string;
  scope: Scope | '';
  studentExamIds: string[];
  reason: string;
};

// A leading minus is allowed here so that "-1" reaches the negative check and is told it is
// negative, rather than being dismissed as "not a number".
const PLAIN_DECIMAL = /^-?\d*\.?\d*$/;

/** Whether the server's own refine would accept this value. The route reads
 *  `Number.isInteger(n * 100)`, which is float arithmetic, so a handful of perfectly legal
 *  two-decimal values are refused: 0.29 * 100 is 28.999999999999996. Measured over every
 *  two-decimal value up to 9999.99, 131,256 of them are refused, including 0.07, 0.14, 0.29
 *  and 1.09. The UI checks the same condition so it can explain the refusal instead of
 *  letting the round trip fail with a decimal-place message about a value that has two. */
function serverAccepts(value: number): boolean {
  return Number.isInteger(value * 100);
}

function isPlainDecimal(raw: string): boolean {
  return PLAIN_DECIMAL.test(raw) && raw !== '' && /[0-9]/.test(raw);
}

function decimalPlaces(raw: string): number {
  const dot = raw.indexOf('.');
  return dot === -1 ? 0 : raw.length - dot - 1;
}

/** The nearest value with the same magnitude the server will accept, so a refusal can offer
 *  a way forward instead of only a complaint. Verified against serverAccepts before it is
 *  suggested, never assumed. */
function safeAlternative(value: number): number | null {
  for (const step of [0.01, -0.01, 0.1, -0.1, 1, -1]) {
    const candidate = Number((value + step).toFixed(MAX_DECIMAL_PLACES));
    if (candidate < 0 || candidate > MAX_POINTS) continue;
    if (serverAccepts(candidate)) return candidate;
  }
  return null;
}

export function parsePoints(raw: string): number | null {
  if (pointsRefusal(raw) !== null) return null;
  return Number(raw.trim());
}

/** null when the server would take the value, otherwise the sentence explaining why not. */
export function pointsRefusal(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 'points is required for a set_points adjustment';
  if (!isPlainDecimal(trimmed)) return 'points must be a number';
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'points must be a number';
  if (value < 0) return 'points cannot be negative';
  if (value > MAX_POINTS) return `points cannot be greater than ${MAX_POINTS}`;
  if (decimalPlaces(trimmed) > MAX_DECIMAL_PLACES) {
    return `points can have at most ${MAX_DECIMAL_PLACES} decimal places, which is what the grade column stores`;
  }
  if (!serverAccepts(value)) {
    const alternative = safeAlternative(value);
    const suggestion =
      alternative === null
        ? 'try a whole or one-decimal value instead'
        : `use ${alternative} instead`;
    return `${trimmed} has two decimal places but the server will not store it, because it computes ${trimmed} x 100 as ${
      value * 100
    }. ${suggestion.charAt(0).toUpperCase()}${suggestion.slice(1)}.`;
  }
  return null;
}

export function validateCompensation(draft: CompensationDraft): string[] {
  const problems: string[] = [];

  if (draft.questionId === '') problems.push('Choose the question to compensate.');
  if (draft.scope === '') problems.push('Choose who the adjustment applies to.');
  if (draft.scope === 'selected' && draft.studentExamIds.length === 0) {
    problems.push('Choose at least one student, or switch to everyone who received this question.');
  }
  if (draft.reason.trim().length < MIN_REASON_LENGTH) {
    problems.push(`Give a reason of at least ${MIN_REASON_LENGTH} characters, which is recorded in the audit trail.`);
  }
  if (draft.adjustmentType === 'set_points') {
    const refusal = pointsRefusal(draft.points);
    if (refusal !== null) problems.push(refusal);
  }

  return problems;
}

export function buildCompensationPayload(draft: CompensationDraft): CompensateBody | null {
  if (validateCompensation(draft).length > 0) return null;

  const payload: CompensateBody = {
    source_question_id: draft.questionId,
    adjustment_type: draft.adjustmentType,
    reason: draft.reason.trim(),
  };

  // The whole-cohort case is expressed by omitting the field. An empty array is not the same
  // request: applyGradeCompensation only narrows when the list is non-empty, so sending one
  // would be accepted and would still hit every student.
  if (draft.scope === 'selected') payload.student_exam_ids = draft.studentExamIds;

  if (draft.adjustmentType === 'set_points') {
    // Through parsePoints, not Number(): validateCompensation has already established the value is
    // one the server accepts, and parsePoints is the single place that knows that rule.
    const points = parsePoints(draft.points);
    if (points === null) return null;
    payload.points = points;
  }

  return payload;
}

export type CompensationOutcome = {
  pending: number;
  detail: string;
};

export function compensationOutcome(result: {
  adjustmentCount: number;
  totalGradeRecalculated: number;
}): CompensationOutcome {
  const { adjustmentCount, totalGradeRecalculated } = result;
  const pending = Math.max(0, adjustmentCount - totalGradeRecalculated);

  // Unreachable from the route, which always reports at least one row it wrote. Guarded anyway
  // because the alternative is a sentence claiming "All 0 attempt total grades were recalculated",
  // and a success alert is the worst place to print a number that cannot be.
  if (adjustmentCount === 0) {
    return {
      pending: 0,
      detail:
        'The server accepted the request but recorded no adjustment. Nothing was changed, and this page does not know which attempt it did not match.',
    };
  }

  // Three cases rather than one template with a conditional plural, because "1 of 1 attempt
  // total" reads as though "attempt total" were the unit. That sentence shipped once because
  // no test pinned the 1/1 wording; there is one now.
  const applied =
    pending === 0 && adjustmentCount === 1
      ? "1 attempt's total grade was recalculated straight away."
      : pending === 0
        ? `All ${adjustmentCount} attempt total grades were recalculated straight away.`
        : `${totalGradeRecalculated} of ${adjustmentCount} attempt total grades were recalculated straight away.`;

  if (pending === 0) return { pending, detail: applied };

  const held =
    pending === 1
      ? '1 attempt is still in progress, so its adjustment is recorded now and applied when the student submits.'
      : `${pending} attempts are still in progress, so their adjustments are recorded now and applied when those students submit.`;
  return { pending, detail: `${applied} ${held}` };
}

/** The one sentence standing between a doctor and a cohort-wide write, so `null` is a real state
 *  and not a synonym for zero.
 *
 *  The attempt list comes from a second, deliberately non-fatal request (GET /exams/:id/live), so it
 *  can fail while the page itself works — and it is refused for an admin on another owner's exam
 *  without exams.manage_all, which the compensation route does not require. Rendering its empty
 *  array as a count printed "0 attempts are on file" in the one sentence whose job is to stop an
 *  accidental blast, and "0" reads as "this will do nothing": the most permissive possible
 *  misreading. An unknown is stated as unknown. */
export function cohortWarning(questionText: string, attemptCount: number | null): string {
  const blast =
    attemptCount === null
      ? 'The attempt list could not be loaded, so how many students this reaches is unknown.'
      : `${attemptCount === 1 ? '1 attempt is' : `${attemptCount} attempts are`} on file for this exam.`;
  return `This awards the new points to every student who received "${questionText}". ${blast} Students who were given a different sample of questions are not affected. This cannot be undone from here.`;
}

export function canCompensate(status: string): { allowed: boolean; reason: string } {
  if (status === 'approved') return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason: 'Only approved exams can receive grade adjustments, and the server refuses this one regardless of what is sent.',
  };
}

export function pointsValue(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The exam's pool is a superset of what students received, so it is the picker. A question that
 *  already carries an adjustment stays selectable even if it has since left the pool, because
 *  re-running a correction on it is the only way to fix a mistaken one.
 *
 *  The pool argument is typed as possibly-absent and defaulted rather than assumed. GET /exams/:id
 *  answers `{ exam }`, not a bare exam, so reading the wrong level yields undefined here — and a
 *  `.map` on it throws inside a useMemo with a typechecker that agreed the field was always
 *  present. A guard that reads as protection but is never exercised is worse than none, so this
 *  one is exercised by tests and the browser found the version that was not. */
export function pickableQuestions(
  pool: ReadonlyArray<{ question?: { id?: string; text?: string } | null }> | null | undefined,
  adjustments: AuditRow[] | null | undefined
): PickableQuestion[] {
  const seen = new Set<string>();
  const merged: PickableQuestion[] = [];

  for (const row of pool ?? []) {
    const id = row?.question?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, text: row.question?.text ?? 'Unknown question' });
  }

  for (const adjustment of adjustments ?? []) {
    const id = adjustment?.student_exam_question?.question_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, text: adjustment.student_exam_question?.text ?? 'Unknown question' });
  }

  return merged;
}

export type AuditRowView = {
  id: string;
  previous_points: number;
  new_points: number;
  delta: number;
  actor_name: string;
  student_name: string;
  student_code: string | null;
  question_text: string;
  reason: string;
  created_at: string;
  adjustment_type: AdjustmentType;
  /** true once the row's attempt has a final grade, null when the attempt list could not be
   *  loaded. See the note on auditRows for why the third state exists. */
  pending: boolean | null;
};

/** The tag a not-yet-graded row carries, worded from the same vocabulary as compensationOutcome so
 *  the transient message and the durable record describe the same event the same way. */
export const PENDING_TAG = 'recorded — applied when the student submits';

/** Shown once above the table when the attempt list is unavailable, because per-row guessing would
 *  be worse than saying it once. */
export const AUDIT_PENDING_UNKNOWN =
  'The attempt list could not be loaded, so this table cannot say which of these changes a grade straight away and which are held until the student submits.';

/** The attempt statuses whose grades the service has already recomputed. Every other status means
 *  the adjustment is recorded but the total_grade has not moved. */
const GRADED_STATUSES = ['submitted', 'auto_submitted'];

/**
 * The adjustments route does not select student_exam.status, so whether a row has taken effect is
 * joined against GET /exams/:id/live on the StudentExam id.
 *
 * This is tri-state on purpose. applyGradeCompensation records previous_points 0 and new_points 2
 * for a full_credit on an in_progress attempt and changes nothing at all, so a row rendered
 * without this tag asserts a grade change that has not happened — and the audit trail is the
 * durable artefact, visited again days later, where the transient success alert is long gone. The
 * reverse error is equally real: with no attempt list, a bare "applied" reading is the same false
 * statement pointing the other way. So an unknown row is null and the page says so once, rather
 * than resolving it in either direction.
 */
export function auditRows(
  adjustments: AuditRow[] | null | undefined,
  attempts: LiveAttempt[] | null | undefined
): AuditRowView[] {
  if (!Array.isArray(adjustments)) return [];

  const ungraded = new Set<string>();
  if (Array.isArray(attempts)) {
    for (const attempt of attempts) {
      if (attempt && !GRADED_STATUSES.includes(attempt.status)) ungraded.add(attempt.student_exam_id);
    }
  }
  const known = Array.isArray(attempts);

  return adjustments.map((adjustment) => {
    const previous = pointsValue(adjustment.previous_points);
    const next = pointsValue(adjustment.new_points);
    const studentExamId = adjustment.student_exam_question?.student_exam?.id;
    return {
      id: adjustment.id,
      previous_points: previous,
      new_points: next,
      delta: Number((next - previous).toFixed(MAX_DECIMAL_PLACES)),
      actor_name: adjustment.actor?.full_name ?? 'Unknown',
      student_name: adjustment.student_exam_question?.student_exam?.student?.full_name ?? 'Unknown student',
      student_code: adjustment.student_exam_question?.student_exam?.student?.student_code ?? null,
      question_text: adjustment.student_exam_question?.text ?? 'Unknown question',
      reason: adjustment.reason,
      created_at: adjustment.created_at,
      adjustment_type: adjustment.adjustment_type,
      pending: known && studentExamId !== undefined ? ungraded.has(studentExamId) : null,
    };
  });
}
