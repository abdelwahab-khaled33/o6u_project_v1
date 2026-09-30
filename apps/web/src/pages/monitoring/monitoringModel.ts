import type { AccessCodeResponse, LiveAttempt, RequestFailure } from './monitoringTypes';

/**
 * A doctor cohort is 3,200 students on the load-test exam, and the live route answers
 * all of them in one ~900 KB body. Rendering every row is slow and unreadable, so the
 * table is capped and the page states how many it withheld. The number is exported so
 * the page and its tests cannot disagree about it.
 */
export const LIVE_RENDER_CAP = 200;

export const DUE_SOON_MINUTES = 5;
const DUE_SOON_MS = DUE_SOON_MINUTES * 60_000;

/** The only statuses that have never reached an administrator. A rejected exam gets no hint. */
const NOT_YET_APPROVED = ['draft', 'pending_approval'];

export type AccessCodeView =
  | { kind: 'loading' }
  | { kind: 'code'; code: string; expiresAt: string | null }
  | { kind: 'no-code'; message: string; hint: string | null }
  | { kind: 'error'; message: string };

/**
 * The server decides whether a code exists; the client's only job is to decide which of
 * its own reasons it is allowed to name. 409 alone means "no code for now" — anything
 * else (403, 404, a dead network) is a failure and must not be dressed up as an empty box.
 */
export function accessCodeView(input: {
  status: string | null;
  code: AccessCodeResponse | null;
  failure: RequestFailure | null;
}): AccessCodeView {
  if (input.code) {
    return { kind: 'code', code: input.code.access_code, expiresAt: input.code.access_code_expires_at };
  }
  if (input.failure === null) return { kind: 'loading' };
  if (input.failure.status !== 409) return { kind: 'error', message: input.failure.message };

  const hint = input.status !== null && NOT_YET_APPROVED.includes(input.status)
    ? 'An access code is issued when an administrator approves this exam, so there is nothing to hand out yet.'
    : null;
  return { kind: 'no-code', message: input.failure.message, hint };
}

/**
 * `format` is injected so this stays free of the shared date helper, which lives in a
 * .tsx module and would drag React into a pure model.
 */
export function codeExpiryText(
  expiresAt: string | null,
  now: number,
  format: (iso: string) => string,
): string {
  if (expiresAt === null) return 'No expiry was reported for this code.';
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 'The expiry reported for this code could not be read.';
  return at <= now ? `Expired ${format(expiresAt)}.` : `Valid until ${format(expiresAt)}.`;
}

export type LiveCensus = {
  total: number;
  not_started: number;
  in_progress: number;
  submitted: number;
  auto_submitted: number;
  /** Statuses this build does not know about. Counted, never dropped silently. */
  other: number;
};

/** null means "the attempt list never loaded", which must never print as a count of zero. */
export function liveCensus(attempts: LiveAttempt[] | null): LiveCensus | null {
  if (attempts === null) return null;
  const census: LiveCensus = {
    total: attempts.length,
    not_started: 0,
    in_progress: 0,
    submitted: 0,
    auto_submitted: 0,
    other: 0,
  };
  for (const attempt of attempts) {
    if (attempt.status in census) census[attempt.status] += 1;
    else census.other += 1;
  }
  return census;
}

export type OnlineState = 'online' | 'offline' | 'not-running' | 'unknown';

export const ONLINE_LABELS: Record<OnlineState, string> = {
  online: 'Online',
  offline: 'Offline',
  'not-running': 'Not running',
  unknown: 'Unknown',
};

export function onlineState(attempt: Pick<LiveAttempt, 'status' | 'online'>): OnlineState {
  if (attempt.online === true) return 'online';
  if (attempt.online === false) return 'offline';
  // The route omits `online` for anything not in progress. An in_progress row without
  // it is a shape this build did not expect, and reads as "not running" would be a lie.
  return attempt.status === 'in_progress' ? 'unknown' : 'not-running';
}

export function filterAttempts(
  attempts: LiveAttempt[],
  query: string,
  status: string,
): LiveAttempt[] {
  const needle = query.trim().toLowerCase();
  return attempts.filter((attempt) => {
    if (status !== '' && attempt.status !== status) return false;
    if (needle === '') return true;
    const { full_name, student_code } = attempt.student;
    return (
      full_name.toLowerCase().includes(needle) ||
      (student_code !== null && student_code.toLowerCase().includes(needle))
    );
  });
}

export function visibleRows<T>(rows: T[], cap: number = LIVE_RENDER_CAP): {
  rows: T[];
  hidden: number;
  total: number;
} {
  return { rows: rows.slice(0, cap), hidden: Math.max(0, rows.length - cap), total: rows.length };
}

export type DeadlineState = 'overdue' | 'due-soon' | 'ok' | 'none';

export function deadlineState(deadlineAt: string | null, status: string, now: number): DeadlineState {
  if (status !== 'in_progress' || deadlineAt === null) return 'none';
  const remaining = Date.parse(deadlineAt) - now;
  if (Number.isNaN(remaining)) return 'none';
  if (remaining <= 0) return 'overdue';
  return remaining <= DUE_SOON_MS ? 'due-soon' : 'ok';
}

/**
 * Release clears a device binding, so it is only meaningful for an attempt that is
 * actually running. `has_active_session` alone is not enough: the field is true on
 * submitted rows too, so without the status check this would offer to release 2,695
 * finished attempts.
 */
export function canRelease(attempt: Pick<LiveAttempt, 'status' | 'has_active_session'>): {
  allowed: boolean;
  reason: string;
} {
  if (attempt.status !== 'in_progress') {
    return { allowed: false, reason: 'This attempt is not in progress, so there is no session to release.' };
  }
  if (!attempt.has_active_session) {
    return { allowed: false, reason: 'This attempt has no active session to release.' };
  }
  return { allowed: true, reason: 'Release this device session so the student can resume on a replacement device.' };
}

export function releaseDialogCopy(): string {
  return 'Releasing clears the device binding for this attempt so the student can resume on a replacement device. It does not pause the clock and it does not submit the attempt.';
}

/** Repeated after a successful release, because that is the part people misread. */
export const RELEASE_NOTE = 'The clock kept running and nothing was submitted.';

/**
 * The server's release message carries no trailing full stop, so joining it to RELEASE_NOTE
 * verbatim produced "…replacement device The clock kept running". Terminal dots are stripped
 * before one is added, which also leaves a period that ends an abbreviation ("12:00 p.m")
 * exactly where the writer put it.
 */
export function releaseNotice(studentName: string, serverMessage: string): string {
  const trimmed = serverMessage.trim();
  const body = trimmed === '' ? '' : `${trimmed.replace(/\.+$/, '')}.`;
  const lead = studentName.trim() === '' ? '' : `${studentName.trim()} — `;
  return body === '' ? `${lead.trimEnd()}. ${RELEASE_NOTE}` : `${lead}${body} ${RELEASE_NOTE}`;
}

/** Returns a new list; the caller re-renders without refetching 900 KB. */
export function applyRelease(attempts: LiveAttempt[], studentExamId: string): LiveAttempt[] {
  return attempts.map((attempt) =>
    attempt.student_exam_id === studentExamId ? { ...attempt, has_active_session: false } : attempt,
  );
}