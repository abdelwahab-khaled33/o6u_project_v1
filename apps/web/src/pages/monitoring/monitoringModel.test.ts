import { describe, it, expect } from 'vitest';

import {
  DUE_SOON_MINUTES,
  LIVE_RENDER_CAP,
  ONLINE_LABELS,
  RELEASE_NOTE,
  accessCodeView,
  applyRelease,
  canRelease,
  codeExpiryText,
  deadlineState,
  filterAttempts,
  liveCensus,
  onlineState,
  releaseDialogCopy,
  releaseNotice,
  visibleRows,
} from './monitoringModel';
import type { LiveAttempt } from './monitoringTypes';

const format = (iso: string) => `<${iso}>`;

function attempt(overrides: Partial<LiveAttempt> & { student_exam_id: string }): LiveAttempt {
  return {
    student: { id: `u-${overrides.student_exam_id}`, full_name: 'Ada Lovelace', student_code: 'S81342' },
    status: 'in_progress',
    answered_count: 0,
    deadline_at: null,
    has_active_session: true,
    ...overrides,
  };
}

const submitted = attempt({ student_exam_id: 'a1', status: 'submitted', has_active_session: true });
const running = attempt({ student_exam_id: 'a2', status: 'in_progress', online: false });
const neverStarted = attempt({ student_exam_id: 'a3', status: 'not_started' });

describe('accessCodeView', () => {
  it('is loading when the request is still open, so it cannot be mistaken for a failure', () => {
    expect(accessCodeView({ status: 'approved', code: null, failure: null })).toEqual({ kind: 'loading' });
  });

  it('returns the code when the server sent one', () => {
    const view = accessCodeView({
      status: 'approved',
      code: { access_code: '2KUSV7', access_code_expires_at: '2026-09-28T21:22:12.803Z' },
      failure: null,
    });
    expect(view).toEqual({
      kind: 'code',
      code: '2KUSV7',
      expiresAt: '2026-09-28T21:22:12.803Z',
    });
  });

  it('reports a 409 as "no code" and keeps the server wording verbatim', () => {
    const view = accessCodeView({
      status: 'approved',
      code: null,
      failure: { status: 409, message: 'An access code is not available for this exam' },
    });
    expect(view).toEqual({
      kind: 'no-code',
      message: 'An access code is not available for this exam',
      hint: null,
    });
  });

  it('adds a hint for a pending exam, because that is the one reason this page can name', () => {
    const view = accessCodeView({
      status: 'pending_approval',
      code: null,
      failure: { status: 409, message: 'An access code is not available for this exam' },
    });
    expect(view.kind).toBe('no-code');
    expect(view.kind === 'no-code' && view.hint).toContain('approves this exam');
  });

  it('names the reason for a draft too', () => {
    const view = accessCodeView({
      status: 'draft',
      code: null,
      failure: { status: 409, message: 'An access code is not available for this exam' },
    });
    expect(view.kind === 'no-code' && view.hint).toContain('approves this exam');
  });

  it('says no hint for a rejected exam rather than guessing why', () => {
    const view = accessCodeView({
      status: 'rejected',
      code: null,
      failure: { status: 409, message: 'An access code is not available for this exam' },
    });
    expect(view.kind === 'no-code' && view.hint).toBeNull();
  });

  it('says no hint when the exam status itself never loaded', () => {
    const view = accessCodeView({
      status: null,
      code: null,
      failure: { status: 409, message: 'An access code is not available for this exam' },
    });
    expect(view.kind === 'no-code' && view.hint).toBeNull();
  });

  it('passes a 403 through as an error, not as "no code"', () => {
    const view = accessCodeView({
      status: 'approved',
      code: null,
      failure: { status: 403, message: 'You do not own this exam' },
    });
    expect(view).toEqual({ kind: 'error', message: 'You do not own this exam' });
  });

  it('passes a 404 through as an error', () => {
    const view = accessCodeView({
      status: 'approved',
      code: null,
      failure: { status: 404, message: 'Exam not found' },
    });
    expect(view.kind).toBe('error');
  });

  it('treats a failure with no status as an error, because 409 alone means "no code"', () => {
    const view = accessCodeView({
      status: 'pending_approval',
      code: null,
      failure: { status: null, message: 'Network error' },
    });
    expect(view).toEqual({ kind: 'error', message: 'Network error' });
  });
});

describe('codeExpiryText', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');

  it('reports a future expiry as valid', () => {
    expect(codeExpiryText('2026-09-30T13:00:00.000Z', now, format)).toBe(
      'Valid until <2026-09-30T13:00:00.000Z>.',
    );
  });

  it('reports a past expiry as expired', () => {
    expect(codeExpiryText('2026-09-30T11:00:00.000Z', now, format)).toBe(
      'Expired <2026-09-30T11:00:00.000Z>.',
    );
  });

  it('treats the exact deadline instant as expired, not valid', () => {
    expect(codeExpiryText('2026-09-30T12:00:00.000Z', now, format)).toContain('Expired');
  });

  it('does not invent an expiry when the server sent none', () => {
    expect(codeExpiryText(null, now, format)).toBe('No expiry was reported for this code.');
  });

  it('says so when the expiry cannot be parsed', () => {
    expect(codeExpiryText('not-a-date', now, format)).toBe(
      'The expiry reported for this code could not be read.',
    );
  });
});

describe('liveCensus', () => {
  const rows = [
    attempt({ student_exam_id: 'a1', status: 'submitted' }),
    attempt({ student_exam_id: 'a2', status: 'submitted' }),
    attempt({ student_exam_id: 'a3', status: 'auto_submitted' }),
    attempt({ student_exam_id: 'a4', status: 'in_progress' }),
    attempt({ student_exam_id: 'a5', status: 'not_started' }),
    attempt({ student_exam_id: 'a6', status: 'not_started' }),
    attempt({ student_exam_id: 'a7', status: 'not_started' }),
  ];

  it('tallies every status', () => {
    expect(liveCensus(rows)).toEqual({
      total: 7,
      submitted: 2,
      auto_submitted: 1,
      in_progress: 1,
      not_started: 3,
      other: 0,
    });
  });

  it('returns null when the attempts never loaded, so "unknown" is never printed as zero', () => {
    expect(liveCensus(null)).toBeNull();
  });

  it('distinguishes a genuinely empty exam from an unloaded one', () => {
    expect(liveCensus([])).toEqual({
      total: 0,
      submitted: 0,
      auto_submitted: 0,
      in_progress: 0,
      not_started: 0,
      other: 0,
    });
  });

  it('counts an unrecognised status as other rather than dropping the row', () => {
    const tallied = liveCensus([
      ...rows,
      attempt({ student_exam_id: 'a8', status: 'something_new' as LiveAttempt['status'] }),
    ]);
    expect(tallied).toMatchObject({ total: 8, other: 1 });
  });
});

describe('onlineState', () => {
  it('is online when the server says the heartbeat is recent', () => {
    expect(onlineState(attempt({ student_exam_id: 'a', status: 'in_progress', online: true }))).toBe('online');
  });

  it('is offline for an in-progress attempt whose heartbeat is stale', () => {
    expect(onlineState(running)).toBe('offline');
  });

  it('is not-running for a submitted attempt, which carries no online key at all', () => {
    expect(onlineState(submitted)).toBe('not-running');
  });

  it('is not-running for an attempt that never started', () => {
    expect(onlineState(neverStarted)).toBe('not-running');
  });

  it('is unknown, not not-running, when an in-progress attempt arrives without the key', () => {
    expect(onlineState(attempt({ student_exam_id: 'a', status: 'in_progress' }))).toBe('unknown');
  });

  it('has a label for every state it can return', () => {
    for (const state of ['online', 'offline', 'not-running', 'unknown'] as const) {
      expect(ONLINE_LABELS[state]).toBeTruthy();
    }
    expect(ONLINE_LABELS['not-running']).not.toBe(ONLINE_LABELS.unknown);
  });
});

describe('filterAttempts', () => {
  const rows = [
    attempt({
      student_exam_id: 'a1',
      student: { id: 'u1', full_name: 'Ada Lovelace', student_code: 'S81342' },
    }),
    attempt({
      student_exam_id: 'a2',
      student: { id: 'u2', full_name: 'Grace Hopper', student_code: 'S90001' },
    }),
    attempt({ student_exam_id: 'a3', status: 'not_started', student: { id: 'u3', full_name: 'Alan Turing', student_code: null } }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterAttempts(rows, '', '')).toHaveLength(3);
  });

  it('matches a name case-insensitively', () => {
    expect(filterAttempts(rows, 'ADA love', '').map((row) => row.student_exam_id)).toEqual(['a1']);
  });

  it('matches a student code', () => {
    expect(filterAttempts(rows, 's90001', '').map((row) => row.student_exam_id)).toEqual(['a2']);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(filterAttempts(rows, '   alan   ', '')).toHaveLength(1);
  });

  it('filters by status alone', () => {
    expect(filterAttempts(rows, '', 'not_started').map((row) => row.student_exam_id)).toEqual(['a3']);
  });

  it('combines query and status', () => {
    expect(filterAttempts(rows, 'grace', 'in_progress')).toHaveLength(1);
    expect(filterAttempts(rows, 'grace', 'not_started')).toHaveLength(0);
  });

  it('does not match on a null student code', () => {
    expect(filterAttempts(rows, 'null', '')).toHaveLength(0);
    expect(filterAttempts(rows, 'undefined', '')).toHaveLength(0);
  });

  it('returns an empty list rather than everything when the query matches nothing', () => {
    expect(filterAttempts(rows, 'nobody', '')).toEqual([]);
  });
});

describe('visibleRows', () => {
  const many = Array.from({ length: 3195 }, (_, index) => index);

  it('returns everything under the cap and hides nothing', () => {
    expect(visibleRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], hidden: 0, total: 3 });
  });

  it('caps a large cohort and reports exactly how many were withheld', () => {
    const view = visibleRows(many);
    expect(view.rows).toHaveLength(LIVE_RENDER_CAP);
    expect(view.hidden).toBe(3195 - LIVE_RENDER_CAP);
    expect(view.total).toBe(3195);
  });

  it('keeps the first rows, so an alphabetical page is stable as you search', () => {
    expect(visibleRows(many).rows[0]).toBe(0);
  });

  it('honours an explicit cap', () => {
    expect(visibleRows(many, 10).hidden).toBe(3185);
  });
});

describe('deadlineState', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  const inMinutes = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  it('is ok for a running attempt with time left', () => {
    expect(deadlineState(inMinutes(40), 'in_progress', now)).toBe('ok');
  });

  it('is due-soon inside the window', () => {
    expect(deadlineState(inMinutes(DUE_SOON_MINUTES), 'in_progress', now)).toBe('due-soon');
  });

  it('is overdue once the deadline has passed', () => {
    expect(deadlineState(inMinutes(-1), 'in_progress', now)).toBe('overdue');
  });

  it('is overdue at the exact deadline instant', () => {
    expect(deadlineState(inMinutes(0), 'in_progress', now)).toBe('overdue');
  });

  it('is none for a finished attempt, whose deadline is history', () => {
    expect(deadlineState(inMinutes(-30), 'submitted', now)).toBe('none');
  });

  it('is none for an attempt that never started', () => {
    expect(deadlineState(inMinutes(60), 'not_started', now)).toBe('none');
  });

  it('is none when there is no deadline at all', () => {
    expect(deadlineState(null, 'in_progress', now)).toBe('none');
  });

  it('is none when the deadline cannot be parsed', () => {
    expect(deadlineState('nonsense', 'in_progress', now)).toBe('none');
  });
});

describe('canRelease', () => {
  it('allows releasing a running attempt that has a session', () => {
    expect(canRelease(running).allowed).toBe(true);
  });

  it('explains why a running attempt with no session is not releasable', () => {
    const view = canRelease(attempt({ student_exam_id: 'a', status: 'in_progress', online: false, has_active_session: false }));
    expect(view.allowed).toBe(false);
    expect(view.reason).toContain('no active session');
  });

  it('refuses a submitted attempt even though the server still reports a session on it', () => {
    const view = canRelease(submitted);
    expect(view.allowed).toBe(false);
    expect(view.reason).toContain('not in progress');
  });

  it('refuses an attempt that never started', () => {
    expect(canRelease(neverStarted).allowed).toBe(false);
  });

  it('always returns a reason, so a disabled control can still explain itself', () => {
    for (const row of [submitted, running, neverStarted]) {
      expect(canRelease(row).reason.length).toBeGreaterThan(10);
    }
  });
});

describe('releaseDialogCopy', () => {
  it('says the clock keeps running and nothing is submitted', () => {
    const copy = releaseDialogCopy();
    expect(copy).toContain('does not pause the clock');
    expect(copy).toContain('does not submit the attempt');
  });

  it('says the student resumes on a replacement device', () => {
    expect(releaseDialogCopy()).toContain('replacement device');
  });

  it('pairs with a notice that repeats the same warning', () => {
    expect(RELEASE_NOTE).toContain('clock kept running');
    expect(RELEASE_NOTE).toContain('nothing was submitted');
  });
});

describe('releaseNotice', () => {
  const serverMessage = 'Session released; the student can resume on a replacement device';

  it('joins the server message and the warning as two sentences', () => {
    // Found by running a real release and reading the sentence: the server message has no
    // trailing full stop, so a naive join produced "...replacement device The clock kept
    // running and nothing was submitted."
    expect(releaseNotice('Live student', serverMessage)).toBe(
      `Live student — Session released; the student can resume on a replacement device. ${RELEASE_NOTE}`,
    );
  });

  it('does not double the full stop when the server sends one', () => {
    expect(releaseNotice('Live student', `${serverMessage}.`)).not.toContain('..');
  });

  it('keeps a period that ends an abbreviation intact', () => {
    expect(releaseNotice('Live student', 'Session released at 12:00 p.m')).toContain('p.m. ' + RELEASE_NOTE);
  });

  it('still names the student when the server sent no message', () => {
    expect(releaseNotice('Live student', '')).toContain('Live student');
  });
});

describe('applyRelease', () => {
  it('clears the session flag on the released row only', () => {
    const rows = [submitted, running, neverStarted];
    const next = applyRelease(rows, 'a2');
    // neverStarted also carries has_active_session — the field is true on finished and
    // never-started rows alike, which is why canRelease also checks the status.
    expect(next.map((row) => row.has_active_session)).toEqual([true, false, true]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [running];
    applyRelease(rows, 'a2');
    expect(rows[0]?.has_active_session).toBe(true);
  });

  it('leaves the length unchanged for an id that is not present', () => {
    const rows = [submitted, running];
    expect(applyRelease(rows, 'missing')).toHaveLength(2);
  });

  it('does not touch the online flag, because releasing is not a heartbeat', () => {
    const next = applyRelease([running], 'a2');
    expect(next[0]?.online).toBe(false);
  });
});