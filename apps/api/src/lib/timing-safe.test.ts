import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const { prisma } = vi.hoisted(() => ({ prisma: { exam: { findUnique: vi.fn() } } }));
vi.mock('../lib/prisma.js', () => ({ prisma }));

import { safeEquals } from '../lib/timing-safe.js';
import { evaluateDeviceSession } from '../services/device-session.js';

describe('safeEquals', () => {
  it('returns true for identical strings', () => {
    expect(safeEquals('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(safeEquals('abc123', 'abc124')).toBe(false);
  });

  it('returns false rather than throwing for different lengths', () => {
    // crypto.timingSafeEqual throws on a length mismatch, which would turn a wrong token
    // into a 500 and tell the caller the comparison was attempted at all.
    expect(safeEquals('short', 'a-much-longer-value')).toBe(false);
    expect(safeEquals('', 'x')).toBe(false);
    expect(safeEquals('x', '')).toBe(false);
  });

  it('handles null and undefined on either side', () => {
    expect(safeEquals(null, 'abc')).toBe(false);
    expect(safeEquals('abc', null)).toBe(false);
    expect(safeEquals(null, null)).toBe(true);
    expect(safeEquals(undefined, undefined)).toBe(true);
    expect(safeEquals(undefined, 'abc')).toBe(false);
  });

  it('compares without an early exit, unlike ===', () => {
    // A behavioural pin, not a spy: timingSafeEqual touches every byte, so a prefix
    // cannot be distinguished from a total mismatch. What is assertable here is that the
    // helper delegates to the constant-time primitive and still gives the right answer.
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(safeEquals('deadbeef00', 'deadbeef01')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not call timingSafeEqual when the lengths cannot match', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(safeEquals('ab', 'abc')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('evaluateDeviceSession compares the token safely', () => {
  it('still reports SESSION_TOKEN_INVALID for a length-mismatched token', () => {
    const result = evaluateDeviceSession({
      presentedToken: 'short',
      requestIp: '10.0.0.2',
      sessionIp: '10.0.0.2',
      sessionToken: 'a'.repeat(64),
    });

    expect(result).toEqual({ ok: false, code: 'SESSION_TOKEN_INVALID' });
  });

  it('accepts a 64-hex token that matches exactly', () => {
    const token = 'b'.repeat(64);
    const result = evaluateDeviceSession({
      presentedToken: token,
      requestIp: '10.0.0.2',
      sessionIp: '10.0.0.2',
      sessionToken: token,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects a 64-hex token differing only in the final character', () => {
    const result = evaluateDeviceSession({
      presentedToken: 'b'.repeat(63) + 'c',
      requestIp: '10.0.0.2',
      sessionIp: '10.0.0.2',
      sessionToken: 'b'.repeat(64),
    });

    expect(result).toEqual({ ok: false, code: 'SESSION_TOKEN_INVALID' });
  });

  // The three assertions above all pass with a plain `!==` too, so on their own they pin
  // nothing about this change. This is the assertion that does: the comparison itself
  // must go through the constant-time primitive. A status-only test would have been a
  // rubber stamp over the very defect it was written for.
  it('performs the token comparison through the constant-time primitive', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const token = 'c'.repeat(64);

    evaluateDeviceSession({
      presentedToken: token,
      requestIp: '10.0.0.2',
      sessionIp: '10.0.0.2',
      sessionToken: token,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('performs the constant-time comparison even for a rejected token', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    evaluateDeviceSession({
      presentedToken: 'c'.repeat(63) + 'd',
      requestIp: '10.0.0.2',
      sessionIp: '10.0.0.2',
      sessionToken: 'c'.repeat(64),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
