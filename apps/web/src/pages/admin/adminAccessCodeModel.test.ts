import { describe, expect, it } from 'vitest';

import {
  buildRegeneratePayload,
  canRegenerate,
  regenerateNotice,
  regenerateProblem,
  type RegenerateNotice,
} from './adminAccessCodeModel';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const END_TIME = '2026-10-01T18:00:00.000Z';

describe('canRegenerate', () => {
  it('offers the control on an approved exam, the only status the route accepts', () => {
    expect(canRegenerate('approved')).toBe(true);
  });

  it.each(['pending_approval', 'rejected', 'draft', 'locked', 'closed'])(
    'refuses %s, which the server answers 409 for',
    (status) => {
      expect(canRegenerate(status)).toBe(false);
    },
  );

  it('refuses a status this build does not know, rather than guessing', () => {
    expect(canRegenerate('')).toBe(false);
    expect(canRegenerate('APPROVED')).toBe(false);
  });
});

describe('regenerateProblem', () => {
  it('accepts a blank input, because blank means "keep the expiry already on the exam"', () => {
    expect(regenerateProblem('', NOW, END_TIME)).toBeNull();
    expect(regenerateProblem('   ', NOW, END_TIME)).toBeNull();
  });

  // Every boundary below is written as an absolute instant on both sides. A bare
  // "2026-10-01T18:01" is local wall-clock, so comparing one against a Z-suffixed end_time
  // makes the answer depend on the machine's zone — and this file's first draft of these
  // three assertions passed only in some of them.
  it('accepts a future expiry inside the exam window', () => {
    expect(regenerateProblem('2026-09-30T15:00:00.000Z', NOW, END_TIME)).toBeNull();
  });

  it('refuses an expiry that cannot be read', () => {
    expect(regenerateProblem('tomorrow', NOW, END_TIME)).toBe(
      'That expiry could not be read. Pick a date and time again.',
    );
  });

  it('refuses an expiry at or before now, because the code would be born dead', () => {
    expect(regenerateProblem('2026-09-30T11:59:00.000Z', NOW, END_TIME)).toBe(
      'The expiry has to be in the future. A code that is already expired cannot start anything.',
    );
    expect(regenerateProblem('2026-09-30T12:00:00.000Z', NOW, END_TIME)).toBe(
      'The expiry has to be in the future. A code that is already expired cannot start anything.',
    );
  });

  it('refuses an expiry after the exam ends, which the server does not check', () => {
    expect(regenerateProblem('2026-10-01T18:01:00.000Z', NOW, END_TIME)).toBe(
      'The expiry is after the exam ends, so the code would outlive the window students can use it in.',
    );
  });

  it('accepts an expiry exactly at end_time, which is the boundary the server itself falls back to', () => {
    expect(regenerateProblem(END_TIME, NOW, END_TIME)).toBeNull();
  });

  it('does not refuse anything when the exam end cannot be read', () => {
    expect(regenerateProblem('2030-01-01T09:00:00.000Z', NOW, 'not a date')).toBeNull();
  });
});

describe('buildRegeneratePayload', () => {
  it('omits the field entirely when blank, which is what lets the server keep the current expiry', () => {
    expect(buildRegeneratePayload('', NOW, END_TIME)).toEqual({});
    expect(buildRegeneratePayload('   ', NOW, END_TIME)).toEqual({});
    expect(buildRegeneratePayload('', NOW, END_TIME)).not.toHaveProperty('access_code_expires_at');
  });

  it('sends the chosen expiry as an ISO instant', () => {
    expect(buildRegeneratePayload('2026-09-30T18:00', NOW, END_TIME)).toEqual({
      access_code_expires_at: new Date(2026, 8, 30, 18, 0).toISOString(),
    });
  });

  it('reads a datetime-local value as local wall-clock, the conversion the exam wizard already proved', () => {
    // 23:30 local is a different instant on every side of the date line, so the expectation is
    // built the same way rather than frozen as a literal that would only hold in one zone.
    const body = buildRegeneratePayload('2026-09-30T23:30', NOW, END_TIME);
    expect(body).toEqual({ access_code_expires_at: new Date(2026, 8, 30, 23, 30).toISOString() });
  });

  it('returns null rather than a payload the server would refuse or waste', () => {
    expect(buildRegeneratePayload('tomorrow', NOW, END_TIME)).toBeNull();
    expect(buildRegeneratePayload('2026-09-30T11:59:00.000Z', NOW, END_TIME)).toBeNull();
    expect(buildRegeneratePayload('2026-10-01T18:01:00.000Z', NOW, END_TIME)).toBeNull();
  });
});

describe('regenerateNotice', () => {
  const format = (iso: string) => `formatted(${iso})`;
  /** How the screen composes it, so a change in either half still has to produce one sentence. */
  const sentence = (notice: RegenerateNotice) => `New access code ${notice.code}${notice.detail}`;

  it('states the new code, that it replaces the one students hold, and when it expires', () => {
    expect(
      sentence(regenerateNotice('WKS2U8', '2026-09-30T16:00:00.000Z', format, NOW)),
    ).toBe(
      'New access code WKS2U8. It replaces the code students have now, so anyone still holding the old code cannot start this exam. Valid until formatted(2026-09-30T16:00:00.000Z).',
    );
  });

  it('hands the code back separately so the screen can show it as something to read out', () => {
    expect(regenerateNotice('WKS2U8', null, format, NOW).code).toBe('WKS2U8');
  });

  it('never claims the code cannot be seen again, because it can: the owner route decrypts it', () => {
    const notice = sentence(
      regenerateNotice('WKS2U8', '2026-09-30T16:00:00.000Z', format, NOW),
    ).toLowerCase();
    expect(notice).not.toMatch(/once/);
    expect(notice).not.toMatch(/gone|never be seen|no longer available|cannot be recovered/);
  });

  it('says the server reported no expiry rather than printing "Valid until undefined"', () => {
    expect(sentence(regenerateNotice('WKS2U8', null, format, NOW))).toBe(
      'New access code WKS2U8. It replaces the code students have now, so anyone still holding the old code cannot start this exam. The server reported no expiry for this code.',
    );
  });

  it('does not claim the code is valid when the reported expiry is unreadable', () => {
    expect(sentence(regenerateNotice('WKS2U8', 'not a date', format, NOW))).toBe(
      'New access code WKS2U8. It replaces the code students have now, so anyone still holding the old code cannot start this exam. The expiry the server reported could not be read.',
    );
  });

  // The branch that matters most: blanking the expiry keeps the one already on file, so rotating
  // an exam whose code has already lapsed succeeds and hands back a code that cannot start
  // anything. "Valid until" on a past date is a false claim in the sentence somebody reads
  // while telling a class.
  it('refuses to say "Valid until" about an expiry that has already passed', () => {
    const detail = regenerateNotice('WKS2U8', '2026-09-28T00:22:00.000Z', format, NOW).detail;
    expect(detail).not.toContain('Valid until');
    expect(sentence({ code: 'WKS2U8', detail })).toBe(
      'New access code WKS2U8. It replaces the code students have now, so anyone still holding the old code cannot start this exam. It expired formatted(2026-09-28T00:22:00.000Z), so it cannot start anything — regenerate again with an expiry later than that.',
    );
  });

  it('treats the exact instant of expiry as expired, not as still valid', () => {
    expect(regenerateNotice('WKS2U8', new Date(NOW).toISOString(), format, NOW).detail).toContain(
      'It expired',
    );
  });

  it('still calls it valid one millisecond before it lapses', () => {
    expect(
      regenerateNotice('WKS2U8', new Date(NOW + 1).toISOString(), format, NOW).detail,
    ).toContain('Valid until');
  });
});
