/**
 * Logic for the administrator's access-code rotation on /admin/exams.
 *
 * Every rule here exists because the server does not make it. `canRegenerate` mirrors the
 * route's 409 so the control is never offered where it cannot work; the two expiry refusals
 * close states the server happily mints — a code already dead, and a code that outlives the
 * window students can actually use it in. They are client-side only, which is a deliberate
 * limit rather than a fix: the API accepts any datetime it is given.
 */

/** The one body the regenerate route accepts. The field is optional and means "decide for me". */
type RegenerateBody = { access_code_expires_at?: string };

/**
 * The route answers 409 for anything but `approved`, so the control appears there and
 * nowhere else. Comparing exactly also means a status this build has never seen — including
 * one that merely looks like the right word — gets no button rather than a broken one.
 */
export function canRegenerate(status: string): boolean {
  return status === 'approved';
}

/**
 * Blank is legal and is the common case: the server then keeps `access_code_expires_at`,
 * falling back to `end_time` when there is none. That is the whole reason the screen can say
 * "leave it blank" instead of showing a stored expiry it never received — EXAM_LIST_SELECT
 * carries no such field, so an expiry shown here could only ever be one this session invented.
 *
 * An unreadable `endTime` refuses nothing. Not knowing when the exam ends is not the same as
 * knowing the requested expiry is wrong, and the first is a fact this screen can lack.
 */
export function regenerateProblem(input: string, now: number, endTime: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return 'That expiry could not be read. Pick a date and time again.';
  if (at <= now) {
    return 'The expiry has to be in the future. A code that is already expired cannot start anything.';
  }

  const endsAt = Date.parse(endTime);
  if (!Number.isNaN(endsAt) && at > endsAt) {
    return 'The expiry is after the exam ends, so the code would outlive the window students can use it in.';
  }

  return null;
}

/**
 * Returns null instead of a body whenever regenerateProblem has anything to say, so a caller
 * that forgets to validate cannot send a value the server would accept and the admin would
 * regret. An empty object is the meaningful "no opinion" request: sending
 * `access_code_expires_at: ''` would fail the route's z.string().datetime() instead.
 */
export function buildRegeneratePayload(input: string, now: number, endTime: string): RegenerateBody | null {
  const problem = regenerateProblem(input, now, endTime);
  if (problem !== null) return null;

  const trimmed = input.trim();
  if (trimmed === '') return {};

  // datetime-local yields local wall-clock with no offset, so this reads it as local time and
  // converts to UTC. The exam wizard makes the same conversion on the same input type; changing
  // it here alone would make one screen read a boundary the other reads an hour away.
  return { access_code_expires_at: new Date(trimmed).toISOString() };
}

/**
 * `format` is injected for the same reason monitoringModel injects it: the shared date helper
 * lives in a .tsx module and importing it would drag React into a pure model.
 *
 * `now` is passed in rather than read, for two reasons. Reading the clock inside a render is an
 * impure read under react-hooks/purity, and the caller has to supply the moment the rotation
 * happened anyway: this sentence describes the result of that action, so comparing against a
 * later clock would quietly rewrite what the administrator was told.
 *
 * The expired branch is not decoration. Leaving the expiry blank makes the server keep
 * `access_code_expires_at`, so rotating an exam whose code has already lapsed reports success
 * and hands back a code that cannot start anything. "Valid until" on a date in the past would
 * be a false claim in exactly the sentence somebody reads while telling a class.
 *
 * The sentence deliberately omits the claim that would also be false here: it never says the
 * code is shown once. GET /exams/:id/access-code decrypts it again for the owner, and an
 * administrator can always rotate a fresh one.
 */
export type RegenerateNotice = { code: string; detail: string };

export function regenerateNotice(
  code: string,
  expiresAt: string | null,
  format: (iso: string) => string,
  now: number,
): RegenerateNotice {
  const replacement =
    '. It replaces the code students have now, so anyone still holding the old code cannot ' +
    'start this exam.';

  if (expiresAt === null) {
    return { code, detail: `${replacement} The server reported no expiry for this code.` };
  }
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) {
    return { code, detail: `${replacement} The expiry the server reported could not be read.` };
  }
  if (at <= now) {
    return {
      code,
      detail:
        `${replacement} It expired ${format(expiresAt)}, so it cannot start anything — regenerate ` +
        'again with an expiry later than that.',
    };
  }
  return { code, detail: `${replacement} Valid until ${format(expiresAt)}.` };
}
