/**
 * Logic for the administrator's exam review screen.
 *
 * The route decides what is legal; this file only decides what the screen is allowed to
 * claim. The review reads GET /exams/:id, which carries the pool questions with their
 * options and answers (admins never see the question bank, so this is their only chance
 * to verify correctness), and edits through PATCH /exams/:id with scalar fields only:
 * pool and target changes stay with the owning doctor, whose wizard owns that logic.
 */

export type ReviewQuestion = {
  id: string;
  text: string;
  question_type: string;
  difficulty: string;
  options: unknown;
  correct_answer: string;
  grade: number | string;
  image_url: string | null;
  is_archived: boolean;
};

/**
 * Why a pooled question cannot be answered as stored, or null when it can. Archived first:
 * an archived row fails every later check for a reason that is not the question's fault,
 * and the cause on screen must say so.
 */
export function answerabilityProblem(question: ReviewQuestion): string | null {
  if (question.is_archived) {
    return 'This question was deleted (archived) after the exam was built. Replace it from the owning doctor\u2019s bank.';
  }
  if (question.question_type === 'true_false') {
    return question.correct_answer.toLowerCase() === 'true' || question.correct_answer.toLowerCase() === 'false'
      ? null
      : `The stored answer "${question.correct_answer}" is not true or false, so no student can score on it.`;
  }
  const options = Array.isArray(question.options) ? question.options.map(String) : [];
  return options.includes(question.correct_answer)
    ? null
    : `The stored answer "${question.correct_answer}" is not one of the ${options.length} options, so no student can score on it.`;
}

/**
 * A stored grade (Prisma Decimal serializes as a string) as two digits. Every grade column in
 * this schema is Decimal(6,2), so rendering the raw value would show "2" beside "1.50" and
 * misalign the very digits the reviewer is comparing.
 */
export function formatReviewGrade(grade: number | string): string {
  return Number(grade).toFixed(2);
}

/** A datetime-local value as the ISO instant the API parses, or null when there is nothing to send. */
export function toIsoOrNull(local: string): string | null {
  const trimmed = local.trim();
  if (trimmed === '') return null;
  const time = new Date(trimmed).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * A stored ISO instant as the sixteen characters a datetime-local input renders, in the
 * viewer's own timezone. The stored seconds never survive the round trip, so they are cut
 * up front rather than silently kept in state while the input shows something else.
 */
export function toLocalInputValue(iso: string | null): string {
  if (iso === null) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export type AdminEditDraft = {
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: string;
  pointsPerQuestion: string;
};

/**
 * The PATCH body for the scalar fields the admin screen edits. Only changed fields travel:
 * the schema is partial and the untouched values stay exactly as stored. Blanks are omitted,
 * never sent as empty strings the route would refuse.
 */
export function buildAdminEditBody(draft: AdminEditDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (draft.title.trim() !== '') body.title = draft.title.trim();
  const start = toIsoOrNull(draft.startTime);
  if (start !== null) body.start_time = start;
  const end = toIsoOrNull(draft.endTime);
  if (end !== null) body.end_time = end;
  if (draft.durationMinutes.trim() !== '') body.duration_minutes = Number(draft.durationMinutes);
  if (draft.pointsPerQuestion.trim() !== '') body.points_per_question = Number(draft.pointsPerQuestion);
  return body;
}
