/** Pure logic for the student exam runner (FR-28..36, spec 5.1-5.5). Nothing here touches the network
 *  or React, so every rule below is testable without a browser and without a database.
 *
 *  Security: the exam-taking routes already whitelist at the query level and in serializeQuestion
 *  (apps/api/src/routes/student-exams.ts). toStudentQuestion and toStudentExam repeat that whitelist
 *  on this side of the wire, so a payload that ever gained a secret key would lose it here before it
 *  reached a component. There is deliberately no field for a correct answer anywhere in this file. */

export type StudentQuestionType = 'mcq' | 'true_false';

export type StudentQuestion = {
  id: string;
  question_type: StudentQuestionType;
  text: string;
  options: string[];
  image_url: string | null;
  difficulty: string;
  selected_answer: string | null;
  is_flagged: boolean;
  order: number;
};

export type StudentExamSubject = { id: string; code: string; name: string };

export type StudentExamSummary = {
  id: string;
  title: string;
  type: 'doctor_exam' | 'ta_quiz';
  subject: StudentExamSubject;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  points_per_question: number | string;
  status: string;
};

export type StudentAttempt = {
  id: string;
  status: string;
  started_at: string | null;
  deadline_at: string | null;
};

export type StartResponse = {
  student_exam: StudentAttempt;
  server_now: string;
  questions: StudentQuestion[];
};

export type AnswerChoice = { value: string; label: string };

export type ProgressSummary = { total: number; answered: number; unanswered: number; flagged: number };

export type UnansweredNotice = { count: number; message: string };

/** Keys that must never reach a student. `total_grade` and `grade_awarded` are here because FR-36 says
 *  the student never sees a grade again after submitting, and a leak of either would break that even
 *  though the exam routes never send them today. */
export const FORBIDDEN_STUDENT_KEYS = [
  'correct_answer',
  'grade',
  'grade_awarded',
  'total_grade',
  'points_awarded',
  'access_code',
  'access_code_hash',
  'access_code_encrypted',
  'access_code_expires_at',
  'difficulty_mix',
] as const;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unexpected ${what} in the exam response`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function toStudentQuestion(raw: unknown): StudentQuestion {
  const source = asRecord(raw, 'question');
  return {
    id: asString(source.id),
    question_type: source.question_type === 'true_false' ? 'true_false' : 'mcq',
    text: asString(source.text),
    options: asStringArray(source.options),
    image_url: asNullableString(source.image_url),
    difficulty: asString(source.difficulty),
    selected_answer: asNullableString(source.selected_answer),
    is_flagged: asBoolean(source.is_flagged),
    order: asNumber(source.order),
  };
}

export function toStudentExam(raw: unknown): StudentExamSummary {
  const source = asRecord(raw, 'exam');
  const subject = asRecord(source.subject, 'subject');
  return {
    id: asString(source.id),
    title: asString(source.title),
    type: source.type === 'ta_quiz' ? 'ta_quiz' : 'doctor_exam',
    subject: {
      id: asString(subject.id),
      code: asString(subject.code),
      name: asString(subject.name),
    },
    duration_minutes: asNumber(source.duration_minutes),
    start_time: asString(source.start_time),
    end_time: asString(source.end_time),
    points_per_question:
      typeof source.points_per_question === 'number' || typeof source.points_per_question === 'string'
        ? source.points_per_question
        : 0,
    status: asString(source.status),
  };
}

export function toStartResponse(raw: unknown): StartResponse {
  const source = asRecord(raw, 'start response');
  const attempt = asRecord(source.student_exam, 'attempt');
  return {
    student_exam: {
      id: asString(attempt.id),
      status: asString(attempt.status),
      started_at: asNullableString(attempt.started_at),
      deadline_at: asNullableString(attempt.deadline_at),
    },
    server_now: asString(source.server_now),
    questions: Array.isArray(source.questions) ? source.questions.map(toStudentQuestion) : [],
  };
}

/** Grading compares option TEXT, not position (exam-grading.ts:39), and the server shuffles the options
 *  when it builds the snapshot. So the answer sent back is the option's own text, read off the choice the
 *  student picked. A true/false question derives its two options from its type, because buildSnapshot
 *  writes ['true','false'] unconditionally and never reads the stored options. */
export function answerChoices(question: StudentQuestion): AnswerChoice[] {
  if (question.question_type === 'true_false') {
    return [
      { value: 'true', label: 'True' },
      { value: 'false', label: 'False' },
    ];
  }
  return question.options.map((option) => ({ value: option, label: option }));
}

export function isAnswered(question: StudentQuestion): boolean {
  return typeof question.selected_answer === 'string' && question.selected_answer !== '';
}

export function answeredIds(questions: StudentQuestion[]): string[] {
  return questions.filter(isAnswered).map((question) => question.id);
}

export function unansweredIds(questions: StudentQuestion[]): string[] {
  return questions.filter((question) => !isAnswered(question)).map((question) => question.id);
}

export function progressSummary(questions: StudentQuestion[]): ProgressSummary {
  return {
    total: questions.length,
    answered: questions.filter(isAnswered).length,
    unanswered: questions.filter((question) => !isAnswered(question)).length,
    flagged: questions.filter((question) => question.is_flagged).length,
  };
}

export function formatCountdown(remaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(remaining / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** server_now is returned with every start and heartbeat, so the countdown can correct for a browser
 *  clock that is wrong by seconds or minutes rather than trusting the local one. */
export function clockOffsetMs(serverNow: string, clientNow: number): number {
  const parsed = new Date(serverNow).getTime();
  if (Number.isNaN(parsed)) return 0;
  return parsed - clientNow;
}

export function remainingMs(deadlineAt: string | null, offsetMs: number, clientNow: number): number {
  if (!deadlineAt) return 0;
  const deadline = new Date(deadlineAt).getTime();
  if (Number.isNaN(deadline)) return 0;
  return Math.max(0, deadline - (clientNow + offsetMs));
}

export function isTimeUp(remaining: number): boolean {
  return remaining <= 0;
}

function errorBody(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error == null || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; payload?: unknown; message?: unknown };
  if (typeof candidate.status !== 'number') return null;
  const payload = candidate.payload;
  return {
    status: candidate.status,
    body: payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
  };
}

function serverMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The submit handler answers 409 with an exact unanswered_count. Showing the real number and the fact
 *  that nothing was lost is the difference between a student who fixes three questions and a student who
 *  assumes the exam is over. */
export function submitBlockedNotice(error: unknown): UnansweredNotice | null {
  const failure = errorBody(error);
  if (!failure || failure.status !== 409) return null;
  if (failure.body.error !== 'All questions must be answered before submitting') return null;
  const count = failure.body.unanswered_count;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  const noun = count === 1 ? 'question' : 'questions';
  return {
    count,
    message: `You still have ${count} ${noun} to answer. Nothing has been submitted — your answers are saved.`,
  };
}

export const ACCESS_CODE_LENGTH = 6;

/** The server hashes the code exactly as typed, against an uppercase-only alphabet, so a lowercase
 *  keystroke is a wrong guess and costs one of the five attempts a student is allowed each minute.
 *  The alphabet is deliberately not hardcoded here: the runner does not need to know it, and putting
 *  it in the bundle would narrow an offline brute force for no benefit. */
export function normaliseAccessCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase().slice(0, ACCESS_CODE_LENGTH);
}

export function accessCodeInputProblem(raw: string): string | null {
  const code = normaliseAccessCode(raw);
  if (code.length === ACCESS_CODE_LENGTH) return null;
  const missing = ACCESS_CODE_LENGTH - code.length;
  if (code.length === 0) return 'Enter the 6-character access code.';
  return `${missing} more ${missing === 1 ? 'character' : 'characters'} to go.`;
}

export function accessCodeProblem(error: unknown): string | null {
  const failure = errorBody(error);
  if (!failure) return null;
  const code = failure.body.error;
  if (typeof code !== 'string') return null;
  if (failure.status === 429) {
    const message = failure.body.message;
    return typeof message === 'string' && message !== '' ? message : 'Too many attempts. Wait a minute and try again.';
  }
  if (code === 'LAB_NETWORK_REQUIRED') {
    return 'This exam can only be taken from the university labs. Connect to the lab network and try again.';
  }
  if (code === 'SEB_REQUIRED') {
    return 'This exam has to be opened in Safe Exam Browser. Close this tab and start again from the browser your lab provides.';
  }
  if (code === 'Invalid access code') {
    return 'That access code is not right. Check the code your supervisor announced and try again.';
  }
  if (code === 'Access code has expired') {
    return 'This access code has expired. Ask your supervisor for a new one.';
  }
  if (code === 'Access code is not available for this exam') {
    return 'This exam has no access code yet. Ask your supervisor before you start.';
  }
  if (code === 'A valid access code is required') {
    return 'Enter the 6-character access code your supervisor announced.';
  }
  if (code === 'Exam has ended') {
    return 'This exam has ended. It is no longer available.';
  }
  if (code === 'Exam has not started yet') {
    return 'This exam has not opened yet. Come back when it starts.';
  }
  if (code === 'Exam is not available') {
    return 'This exam is not available right now. Ask your supervisor if you think that is wrong.';
  }
  if (code === 'You are not eligible for this exam') {
    return 'You are not on the list for this exam. Ask your supervisor if you think that is wrong.';
  }
  return null;
}

/** A 409 with any of these bodies means the attempt is finished rather than broken: the server
 *  finalises an overdue attempt before answering ("…already been auto-submitted"), and when the 30s
 *  heartbeat races the deadline submit, the loser hears "Exam already submitted" — which for a running
 *  attempt is the same finished outcome. The runner reports all of them as finished, never as a failure. */
export function wasAutoSubmitted(error: unknown): boolean {
  const failure = errorBody(error);
  if (!failure) return false;
  const code = failure.body.error;
  return (
    code === 'Deadline already passed; exam has been auto-submitted' ||
    code === 'Deadline passed; exam has been auto-submitted' ||
    code === 'Your time has already expired; this exam has been submitted' ||
    code === 'Exam already submitted' ||
    code === 'This exam has already been submitted'
  );
}

/** Two of these 409s mean the attempt is finished rather than broken: the server finalises an overdue
 *  attempt before answering, so "your time has already expired" is the outcome the student wanted. */
export function examRunProblem(error: unknown): string | null {
  const failure = errorBody(error);
  if (!failure) return null;
  const code = failure.body.error;
  if (typeof code !== 'string') return null;
  if (wasAutoSubmitted(error)) return null;
  if (code === 'SESSION_ACTIVE_ELSEWHERE') {
    const message = failure.body.message;
    return typeof message === 'string' && message !== '' ? message : 'This exam is open on another machine. Ask your supervisor to release your session.';
  }
  if (code === 'SESSION_TOKEN_INVALID') {
    return 'Your exam session token is no longer valid. Ask your supervisor to release your session, then resume.';
  }
  if (code === 'Exam has not been started') {
    return 'This exam has not been started yet.';
  }
  if (code === 'LAB_NETWORK_REQUIRED') {
    return 'This exam can only be taken from the university labs.';
  }
  if (code === 'SEB_REQUIRED') {
    return 'This exam has to be opened in Safe Exam Browser.';
  }
  if (failure.status === 403) return serverMessage(error);
  return null;
}

/** A flag is a convenience, not an answer. Losing it must never undo or hide the answer it was saved with,
 *  so the runner reports nothing and simply re-syncs from the server on the next read. */
export function flagProblem(_error: unknown): string | null {
  return null;
}

export function pointsPerQuestion(points: number | string): number {
  const parsed = Number(points);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const RUNNER_PAGE_SIZE = 5;

export function totalPages(total: number, pageSize: number = RUNNER_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function pageOfIndex(index: number, pageSize: number = RUNNER_PAGE_SIZE): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.floor(index / pageSize);
}

export function clampPage(page: number, pageTotal: number): number {
  if (!Number.isFinite(pageTotal) || pageTotal <= 0) return 0;
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.floor(page)), pageTotal - 1);
}

export function submitConfirmCopy(answered: number, total: number): string {
  const unanswered = Math.max(0, total - answered);
  if (unanswered > 0) {
    const noun = unanswered === 1 ? 'question is' : 'questions are';
    const pronoun = unanswered === 1 ? 'it' : 'them';
    return `You have answered ${answered} of ${total} questions. ${unanswered} ${noun} still blank, so the server will refuse the submission until you answer ${pronoun}.`;
  }
  return `You have answered ${answered} of ${total} questions. Every question is answered.`;
}
