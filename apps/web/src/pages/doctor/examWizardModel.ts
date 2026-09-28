import type { Difficulty } from '@exam/shared';

export type DifficultyMix = { easy: number; medium: number; hard: number };

export type PoolQuestion = {
  id: string;
  difficulty: Difficulty;
  text?: string;
};

export type TargetScope = 'subject' | 'sections' | 'student_list';

export type WizardForm = {
  subjectId: string;
  title: string;
  poolIds: string[];
  mix: DifficultyMix;
  pointsPerQuestion: string;
  durationMinutes: string;
  startLocal: string;
  endLocal: string;
  targetScope: TargetScope;
  targetSectionIds: string[];
  targetStudentIds: string[];
};

export const TITLE_MIN = 2;
export const TITLE_MAX = 150;
export const DURATION_MAX = 360;

/** Exam.points_per_question is `@db.Decimal(6, 2)` in the Prisma schema, and the Zod schema only says
 *  `z.number().positive()`. That gap is not theoretical: posting 0.001 answers 201 and reads back "0",
 *  posting 1.005 answers 201 and reads back "1.01", and posting 99999.99 answers 500. All three were
 *  confirmed against the running server, so the bounds are enforced here where the doctor can see them. */
export const POINTS_MIN = 0.01;
export const POINTS_MAX = 9999.99;
export const POINTS_DECIMALS = 2;

const TIERS: Difficulty[] = ['easy', 'medium', 'hard'];

export function mixTotal(mix: DifficultyMix): number {
  return mix.easy + mix.medium + mix.hard;
}

export type PoolSufficiency = { ok: true } | { ok: false; error: string };

/** Mirrors checkPoolSufficiency in apps/api/src/services/exam-sampling.ts, wording included, so a short pool
 *  disables the button with the same sentence the server would have answered with. The server stays the
 *  authority: this only saves a round trip. */
export function checkPoolSufficiency(
  poolQuestions: Pick<PoolQuestion, 'difficulty'>[],
  mix: DifficultyMix,
): PoolSufficiency {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const question of poolQuestions) counts[question.difficulty] += 1;

  for (const tier of TIERS) {
    const needed = mix[tier] ?? 0;
    if (needed > 0 && counts[tier] < needed) {
      return {
        ok: false,
        error: `Pool has only ${counts[tier]} ${tier} question(s) but ${needed} are required`,
      };
    }
  }
  return { ok: true };
}

/** A datetime-local input yields "2026-10-01T09:00" with no zone, and z.string().datetime() rejects that. */
export function localToIso(value: string): string | null {
  if (value.trim() === '') return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  return parsed.toISOString();
}

export function isoToLocal(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function wholeNumberOrNull(value: string): number | null {
  const parsed = numberOrNull(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveInt(value: string): number | null {
  const parsed = wholeNumberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function wizardProblems(form: WizardForm, bank: Pick<PoolQuestion, 'id' | 'difficulty'>[]): string[] {
  const problems: string[] = [];

  if (form.subjectId === '') problems.push('Choose the subject this exam belongs to.');

  const title = form.title.trim();
  if (title.length < TITLE_MIN) problems.push(`Title must be at least ${TITLE_MIN} characters.`);
  if (title.length > TITLE_MAX) problems.push(`Title must be ${TITLE_MAX} characters or fewer.`);

  if (form.poolIds.length === 0) problems.push('Select at least one question for the pool.');

  if (mixTotal(form.mix) === 0) problems.push('The difficulty mix must ask for at least one question.');
  else {
    // Selected from the bank by id here rather than taking a pre-filtered array, because the one thing
    // that must never happen silently is counting the whole bank instead of the selection.
    const selected = new Set(form.poolIds);
    const sufficiency = checkPoolSufficiency(
      bank.filter((question) => selected.has(question.id)),
      form.mix,
    );
    if (!sufficiency.ok) problems.push(sufficiency.error);
  }

  const points = numberOrNull(form.pointsPerQuestion);
  if (points === null) {
    problems.push('Points per question must be a number.');
  } else if (points < POINTS_MIN || points > POINTS_MAX) {
    problems.push(`Points per question must be between ${POINTS_MIN} and ${POINTS_MAX}.`);
  } else if (Number(points.toFixed(POINTS_DECIMALS)) !== points) {
    problems.push(`Points per question is stored with ${POINTS_DECIMALS} decimal places, so give it at most ${POINTS_DECIMALS}.`);
  }

  const duration = wholeNumberOrNull(form.durationMinutes);
  if (duration === null || duration < 1 || duration > DURATION_MAX) {
    problems.push(`Duration must be a whole number of minutes between 1 and ${DURATION_MAX}.`);
  }

  const start = localToIso(form.startLocal);
  const end = localToIso(form.endLocal);
  if (start === null || end === null) {
    problems.push('Set both a start time and an end time.');
  } else {
    const windowMinutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
    if (windowMinutes <= 0) problems.push('The end time must be after the start time.');
    else if (duration !== null && duration > windowMinutes) {
      problems.push('Duration cannot be longer than the window between the start and end times.');
    }
  }

  if (form.targetScope === 'sections' && form.targetSectionIds.length === 0) {
    problems.push('Choose at least one section, or switch the target back to the whole subject.');
  }
  if (form.targetScope === 'student_list' && form.targetStudentIds.length === 0) {
    problems.push('Choose at least one student, or switch the target back to the whole subject.');
  }

  return problems;
}

export type ExamPayload = {
  subject_id?: string;
  title: string;
  question_pool_ids: string[];
  difficulty_mix: DifficultyMix;
  points_per_question: number;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  target_scope: TargetScope;
  target_section_ids?: string[];
  target_student_ids?: string[];
};

/** Only call this once wizardProblems is empty; it does not re-validate, so a bad form would throw
 *  rather than quietly send a payload the server will reject. */
export function buildExamPayload(
  form: WizardForm,
  { includeSubject = true }: { includeSubject?: boolean } = {},
): ExamPayload {
  const start = localToIso(form.startLocal);
  const end = localToIso(form.endLocal);
  if (start === null || end === null) throw new Error('start and end times are required');

  const payload: ExamPayload = {
    title: form.title.trim(),
    question_pool_ids: [...form.poolIds],
    difficulty_mix: { ...form.mix },
    points_per_question: Number(form.pointsPerQuestion),
    duration_minutes: positiveInt(form.durationMinutes) ?? Number(form.durationMinutes),
    start_time: start,
    end_time: end,
    target_scope: form.targetScope,
  };

  if (includeSubject) payload.subject_id = form.subjectId;
  if (form.targetScope === 'sections') payload.target_section_ids = [...form.targetSectionIds];
  if (form.targetScope === 'student_list') payload.target_student_ids = [...form.targetStudentIds];

  return payload;
}
