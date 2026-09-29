import crypto from 'node:crypto';

/**
 * Equality that does not leak how many leading characters matched.
 *
 * `===` returns on the first differing byte, so the time it takes tells an attacker how
 * far a guessed value got. That matters wherever a guess is a secret: the device-session
 * token and the SEB request hash. A wrong value must still cost the full comparison.
 */
export function safeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch. The length of a fixed-width secret is
  // not itself a secret, so an early "not equal" here leaks nothing a wrong value could
  // not be told anyway, and it keeps a wrong guess from becoming a 500.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
