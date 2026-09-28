import { describe, expect, it } from 'vitest';
import {
  evaluateDeviceSession,
  randomSessionToken,
  readSessionTokenFromCookieHeader,
} from './device-session.js';

describe('randomSessionToken', () => {
  it('returns a 64-character hex string', () => {
    const token = randomSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces distinct tokens', () => {
    expect(randomSessionToken()).not.toBe(randomSessionToken());
  });
});

describe('readSessionTokenFromCookieHeader', () => {
  it('extracts the session token from a single cookie', () => {
    expect(readSessionTokenFromCookieHeader('exam_session_token=abc123')).toBe('abc123');
  });

  it('extracts the session token among several cookies', () => {
    const header = 'theme=dark; exam_session_token=xyz789; lang=en';
    expect(readSessionTokenFromCookieHeader(header)).toBe('xyz789');
  });

  it('returns null when the header or token is absent', () => {
    expect(readSessionTokenFromCookieHeader(undefined)).toBeNull();
    expect(readSessionTokenFromCookieHeader('theme=dark')).toBeNull();
  });
});

describe('evaluateDeviceSession', () => {
  it('allows a fresh attempt with no session bound', () => {
    expect(
      evaluateDeviceSession({
        presentedToken: null,
        requestIp: '10.0.0.2',
        sessionIp: null,
        sessionToken: null,
      }),
    ).toEqual({ ok: true });
  });

  it('allows the same IP with the correct token', () => {
    expect(
      evaluateDeviceSession({
        presentedToken: 'tok-1',
        requestIp: '10.0.0.2',
        sessionIp: '10.0.0.2',
        sessionToken: 'tok-1',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a different IP while a session is active', () => {
    expect(
      evaluateDeviceSession({
        presentedToken: 'tok-1',
        requestIp: '10.0.0.99',
        sessionIp: '10.0.0.2',
        sessionToken: 'tok-1',
      }),
    ).toEqual({ ok: false, code: 'SESSION_ACTIVE_ELSEWHERE' });
  });

  it('rejects a mismatched token on the same IP', () => {
    expect(
      evaluateDeviceSession({
        presentedToken: 'wrong',
        requestIp: '10.0.0.2',
        sessionIp: '10.0.0.2',
        sessionToken: 'tok-1',
      }),
    ).toEqual({ ok: false, code: 'SESSION_TOKEN_INVALID' });
  });

  it('allows a replacement device after the session was released', () => {
    expect(
      evaluateDeviceSession({
        presentedToken: null,
        requestIp: '10.0.0.99',
        sessionIp: null,
        sessionToken: null,
      }),
    ).toEqual({ ok: true });
  });
});