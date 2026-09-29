import crypto from 'node:crypto';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { safeEquals } from '../lib/timing-safe.js';

export const SESSION_COOKIE = 'exam_session_token';

export function randomSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function readSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function setSessionTokenCookie(res: Response, token: string) {
  const secure = env.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`,
  );
}

export function evaluateDeviceSession(params: {
  presentedToken: string | null;
  requestIp: string;
  sessionIp: string | null;
  sessionToken: string | null;
}): { ok: true } | { ok: false; code: 'SESSION_ACTIVE_ELSEWHERE' | 'SESSION_TOKEN_INVALID' } {
  if (params.sessionIp != null && params.requestIp !== params.sessionIp) {
    return { ok: false, code: 'SESSION_ACTIVE_ELSEWHERE' };
  }
  // The token is a 64-hex secret and a guess is a student's whole exam, so it is compared
  // in constant time: `!==` returns on the first differing byte, which hands an attacker a
  // byte-at-a-time oracle on the only value standing between them and a resume.
  if (params.sessionToken != null && !safeEquals(params.presentedToken, params.sessionToken)) {
    return { ok: false, code: 'SESSION_TOKEN_INVALID' };
  }
  return { ok: true };
}