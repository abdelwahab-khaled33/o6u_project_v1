import type { Difficulty } from '@exam/shared';

import {
  DURATION_MAX,
  isoToLocal,
  localToIso,
  POINTS_DECIMALS,
  POINTS_MAX,
  POINTS_MIN,
  TITLE_MAX,
  TITLE_MIN,
  wizardProblems,
  type DifficultyMix,
  type WizardForm,
} from '../doctor/examWizardModel';

/** The shapes the TA screens read. Everything here was taken off a live response from the running
 *  server, not off the Prisma schema, because the two differ: the question-bank list deliberately does
 *  not return the owner foreign keys, and the roster endpoints were added for exactly this screen. */

export type QuizSource = 'shared_bank' | 'own_questions';

export const QUIZ_SOURCES: { value: QuizSource; label: string; hint: string }[] = [
  {
    value: 'shared_bank',
    label: 'The subject bank shared with the subject doctor',
    hint: 'The pool is drawn from the whole shared bank, so you can use questions a colleague or the subject doctor wrote.',
  },
  {
    value: 'own_questions',
    label: 'Only the questions I wrote',
    hint: 'The pool is limited to your own questions in this subject.',
  },
];

export type RosterSection = { id: string; subject_id: string; name: string };

export type RosterStudent = {
  id: string;
  full_name: string;
  student_code: string | null;
  section_id: string;
  section_name: string;
};

export type SharedQuestion = {
  id: string;
  difficulty: Difficulty;
  author?: { id: string; full_name: string } | null;
  can_edit?: boolean;
  /** Server-computed authorship. Required for the own_questions pool, which exams.ts enforces. */
  is_mine?: boolean;
};

export type QuizForm = WizardForm & {
  quizSource: QuizSource;
};

export type QuizPayload = {
  type: 'quiz';
  subject_id?: string;
  title: string;
  question_pool_ids: string[];
  difficulty_mix: DifficultyMix;
  points_per_question: number;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  target_scope: 'sections' | 'student_list';
  quiz_source: QuizSource;
  target_section_ids?: string[];
  target_student_ids?: string[];
};

export const TA_TARGET_SCOPES = [
  { value: 'sections', label: 'One or more of my sections' },
  { value: 'student_list', label: 'A specific list of my students' },
] as const;

export type TaTargetScope = (typeof TA_TARGET_SCOPES)[number]['value'];

export function targetScopeOptions(): { value: TaTargetScope; label: string }[] {
  return TA_TARGET_SCOPES.map((scope) => ({ ...scope }));
}

export function rosterStudentsForSections(
  students: RosterStudent[],
  sectionIds: string[],
): RosterStudent[] {
  if (sectionIds.length === 0) return [];
  const wanted = new Set(sectionIds);
  const seen = new Set<string>();
  const kept: RosterStudent[] = [];
  for (const student of students) {
    if (!wanted.has(student.section_id) || seen.has(student.id)) continue;
    seen.add(student.id);
    kept.push(student);
  }
  return kept;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function wholeNumberOrNull(value: string): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

/** Reuses wizardProblems for everything a quiz shares with a doctor exam — subject, title, pool
 *  sufficiency, points, duration and the open window — then replaces the two messages that are wrong for a
 *  TA. wizardProblems offers to fall back to "the whole subject", which exams.ts:88 refuses for a TA, so
 *  reusing it verbatim would promise a target the server rejects. */
export function taQuizProblems(
  form: QuizForm,
  bank: Pick<SharedQuestion, 'id' | 'difficulty' | 'is_mine'>[],
  roster: { sections: RosterSection[]; students: RosterStudent[] },
  opts: { archivedIds?: string[] } = {},
): string[] {
  // own_questions is enforced server-side, so the bank handed to the shared checks is pre-filtered on
  // the server's own is_mine flag. Without this a mix the caller's own questions cannot cover would pass
  // here and 400 at submit with "Pool must be limited to your own questions".
  const countableBank = form.quizSource === 'own_questions'
    ? bank.filter((question) => question.is_mine === true)
    : bank;

  const shared = wizardProblems(form, countableBank, { archivedIds: opts.archivedIds });
  const problems = shared
    // "this exam belongs to" is wrong copy in a quiz wizard, and the two target sentences offer a
    // fallback the server refuses for a TA, so all three are replaced rather than shown as they are.
    .filter(
      (problem) => !problem.startsWith('Choose at least one section,') && !problem.startsWith('Choose at least one student,'),
    )
    .map((problem) => (problem === 'Choose the subject this exam belongs to.'
      ? 'Choose the subject this quiz belongs to.'
      : problem));

  if (form.targetScope === 'sections') {
    if (form.targetSectionIds.length === 0) {
      problems.push(
        roster.sections.length === 0
          ? 'No section of this subject is assigned to you yet, so there is nobody to target.'
          : 'Choose at least one of your sections.',
      );
    }
  } else if (form.targetStudentIds.length === 0) {
    problems.push(
      roster.students.length === 0
        ? 'No student is enrolled in this subject through your sections, so there is nobody to target.'
        : 'Choose at least one student.',
    );
  }

  return problems;
}

/** Only call this once taQuizProblems is empty; like buildExamPayload it does not re-validate, so a half
 *  filled form would send a payload the server rejects instead of failing here. */
export function buildQuizPayload(
  form: QuizForm,
  { includeSubject = true }: { includeSubject?: boolean } = {},
): QuizPayload {
  const start = localToIso(form.startLocal);
  const end = localToIso(form.endLocal);
  if (start === null || end === null) throw new Error('start and end times are required');

  const duration = wholeNumberOrNull(form.durationMinutes);
  const points = numberOrNull(form.pointsPerQuestion);
  if (duration === null || points === null) throw new Error('duration and points per question must be numbers');

  const payload: QuizPayload = {
    type: 'quiz',
    title: form.title.trim(),
    question_pool_ids: [...form.poolIds],
    difficulty_mix: { ...form.mix },
    points_per_question: points,
    duration_minutes: duration,
    start_time: start,
    end_time: end,
    target_scope: form.targetScope === 'student_list' ? 'student_list' : 'sections',
    quiz_source: form.quizSource,
  };

  if (includeSubject) payload.subject_id = form.subjectId;
  if (payload.target_scope === 'sections') payload.target_section_ids = [...form.targetSectionIds];
  else payload.target_student_ids = [...form.targetStudentIds];

  return payload;
}

export function authorLabel(question: { author?: { id: string; full_name: string } | null }): string {
  return question.author?.full_name ?? 'Unknown author';
}

/** The only authority on whether a row is editable is the server's own flag, computed by the same
 *  canEditQuestion that guards PATCH and DELETE. Nothing in the browser can establish "is this mine", and
 *  comparing author.id against the signed-in user would be a second answer that can drift from the first. */
export function canManageRow(question: { can_edit?: boolean; author?: unknown }): boolean {
  return question.can_edit === true;
}

/** A TA quiz needs no administrator: POST /exams gives it status 'approved' with the TA as approver, and
 *  PATCH computes doctorEditsApproved only for role === 'doctor', so an edit keeps it live. Copy that
 *  mentions approval would describe something the API does not do.
 *
 *  `editing` decides the sentence, never `status`. That is the whole point of taking the flag separately: a
 *  TA quiz is always created approved, so branching on the status made the create path report "Updated". */
export function quizStatusNotice(
  title: string,
  { editing, status }: { editing: boolean; status?: string | null },
): string {
  if (!editing) {
    return `Created "${title}". It is live straight away — students reach it with an access code, and you can read that code from this page.`;
  }
  const staysLive = status === 'approved'
    ? 'The quiz stays live, its access code is unchanged, '
    : `Its status is still ${status ?? 'what it was'}, `;
  return `Updated "${title}". ${staysLive}and any attempts already generated for it are cleared so every target is re-sampled from the pool you just saved.`;
}

export {
  DURATION_MAX,
  isoToLocal,
  localToIso,
  POINTS_DECIMALS,
  POINTS_MAX,
  POINTS_MIN,
  TITLE_MAX,
  TITLE_MIN,
};
