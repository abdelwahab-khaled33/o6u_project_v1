import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export interface ThrottleSpec {
  maxFree: number;
  windowSec: number;
  baseDelaySec: number;
  stepEvery: number;
  maxDelaySec: number;
}

// A student guessing one name from one machine locks only themselves: 5 free
// failures tolerate typo bursts on exam morning, then 30s doubling makes
// scripted guessing dozens per hour instead of thousands.
export const LOGIN_PAIR_THROTTLE: ThrottleSpec = {
  maxFree: 5,
  windowSec: 900,
  baseDelaySec: 30,
  stepEvery: 1,
  maxDelaySec: 900,
};

// One lab machine serves a whole section, so the per-IP budget is far higher:
// 50 failures from one address in 15 minutes is beyond honest typos, and the
// 60s doubling per 10 over kills sweeps without locking out a shared machine.
export const LOGIN_IP_THROTTLE: ThrottleSpec = {
  maxFree: 50,
  windowSec: 900,
  baseDelaySec: 60,
  stepEvery: 10,
  maxDelaySec: 900,
};

// A student retrying from phone, laptop and lab is still one account, so this
// sits above the pair budget; it slows distributed guessing without ever
// hard-locking a real student.
export const LOGIN_ACCOUNT_THROTTLE: ThrottleSpec = {
  maxFree: 20,
  windowSec: 900,
  baseDelaySec: 60,
  stepEvery: 5,
  maxDelaySec: 900,
};

// Change-password already requires the current password; 5 wrong guesses an
// hour stops session-hijack guessing while an honest retry never notices.
// baseDelaySec === maxDelaySec, so the delay is flat: there is no second
// doubling to reach. That is the point, not an oversight.
export const PASSWORD_CHANGE_THROTTLE: ThrottleSpec = {
  maxFree: 5,
  windowSec: 3600,
  baseDelaySec: 3600,
  stepEvery: 1,
  maxDelaySec: 3600,
};

// Admin resets are rarer and more powerful, and every one is audited; 10 an
// hour per admin allows small-batch work and kills scripted abuse. Flat delay
// for the same reason as the change-password spec above.
export const PASSWORD_RESET_THROTTLE: ThrottleSpec = {
  maxFree: 10,
  windowSec: 3600,
  baseDelaySec: 3600,
  stepEvery: 1,
  maxDelaySec: 3600,
};

// Rows older than every window are dead under all specs; recording a failure
// sweeps them so enumeration cannot grow the table without bound.
const CLEANUP_AFTER_SEC = 3600;

function hashKey(scope: string, parts: string[]): string {
  return `${scope}:${crypto.createHash('sha256').update(`${scope}:${parts.join('|')}`).digest('hex')}`;
}

export function loginPairKey(username: string, ip: string): string {
  return hashKey('login-pair', [username.toLowerCase(), ip]);
}

export function loginIpKey(ip: string): string {
  return hashKey('login-ip', [ip]);
}

export function loginAccountKey(username: string): string {
  return hashKey('login-account', [username.toLowerCase()]);
}

export function passwordChangeKey(userId: string): string {
  return hashKey('password-change', [userId]);
}

export function passwordResetKey(adminId: string): string {
  return hashKey('password-reset', [adminId]);
}

export function delayForFailures(failures: number, spec: ThrottleSpec): number {
  if (failures <= spec.maxFree) return 0;
  const steps = Math.floor((failures - spec.maxFree - 1) / spec.stepEvery);
  return Math.min(spec.baseDelaySec * 2 ** steps, spec.maxDelaySec);
}

function windowExpired(windowStartedAt: Date, windowSec: number, now: number): boolean {
  return now - windowStartedAt.getTime() > windowSec * 1000;
}

export interface ThrottleCheck {
  throttled: boolean;
  retryAfterSec: number;
}

export async function checkSingleThrottle(key: string, spec: ThrottleSpec): Promise<ThrottleCheck> {
  const row = await prisma.loginThrottle.findUnique({ where: { key } });
  if (!row || windowExpired(row.window_started_at, spec.windowSec, Date.now())) {
    return { throttled: false, retryAfterSec: 0 };
  }
  return gateByLastAttempt(row.failures, row.updated_at, spec);
}

// A 429 promises "try again in N seconds", so the gate is measured from the
// last counted attempt, not from the window start: once the delay has passed
// since updated_at, one more attempt is let through. If it fails the counter
// climbs and the next delay doubles; if it succeeds the rows are deleted.
// Without this the Retry-After would be a lie -- the counter sits unchanged
// for the whole window, so every retry inside it would meet the same 429.
function gateByLastAttempt(failures: number, updatedAt: Date, spec: ThrottleSpec): ThrottleCheck {
  const retryAfterSec = delayForFailures(failures, spec);
  if (retryAfterSec === 0) return { throttled: false, retryAfterSec: 0 };
  if (Date.now() - updatedAt.getTime() >= retryAfterSec * 1000) {
    return { throttled: false, retryAfterSec: 0 };
  }
  return { throttled: true, retryAfterSec };
}

// The sweep is separate from the increment: one login failure bumps three
// counters, and running the cleanup inside each of those transactions issued
// three identical DELETEs per failed attempt. Called once per failure instead.
export async function sweepStaleThrottleRows(now: Date = new Date()): Promise<void> {
  await prisma.loginThrottle.deleteMany({
    where: { updated_at: { lt: new Date(now.getTime() - CLEANUP_AFTER_SEC * 1000) } },
  });
}

export async function recordSingleThrottle(key: string, spec: ThrottleSpec): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.loginThrottle.findUnique({ where: { key } });
    if (!row || windowExpired(row.window_started_at, spec.windowSec, now.getTime())) {
      await tx.loginThrottle.upsert({
        where: { key },
        create: { key, failures: 1, window_started_at: now },
        update: { failures: 1, window_started_at: now },
      });
    } else {
      await tx.loginThrottle.update({
        where: { key },
        data: { failures: { increment: 1 } },
      });
    }
  });
  await sweepStaleThrottleRows(now);
}

export async function resetSingleThrottle(key: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key } });
}

// One list, read by the gate and the recorder alike. These were two hand-kept
// arrays of the same three pairs, and a fourth counter added to only one of them
// would either count failures nothing ever checks or throttle on a key the
// recorder never bumps.
export function loginCounters(username: string, ip: string): Array<[string, ThrottleSpec]> {
  return [
    [loginPairKey(username, ip), LOGIN_PAIR_THROTTLE],
    [loginAccountKey(username), LOGIN_ACCOUNT_THROTTLE],
    [loginIpKey(ip), LOGIN_IP_THROTTLE],
  ];
}

export async function checkLoginThrottles(username: string, ip: string): Promise<ThrottleCheck> {
  const counters = loginCounters(username, ip);
  const rows = await prisma.loginThrottle.findMany({
    where: { key: { in: counters.map(([key]) => key) } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const now = Date.now();
  let retryAfterSec = 0;
  for (const [key, spec] of counters) {
    const row = byKey.get(key);
    if (!row || windowExpired(row.window_started_at, spec.windowSec, now)) continue;
    const gated = gateByLastAttempt(row.failures, row.updated_at, spec);
    retryAfterSec = Math.max(retryAfterSec, gated.retryAfterSec);
  }
  return { throttled: retryAfterSec > 0, retryAfterSec };
}

export async function recordLoginFailures(username: string, ip: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const [key, spec] of loginCounters(username, ip)) {
      const row = await tx.loginThrottle.findUnique({ where: { key } });
      if (!row || windowExpired(row.window_started_at, spec.windowSec, now.getTime())) {
        await tx.loginThrottle.upsert({
          where: { key },
          create: { key, failures: 1, window_started_at: now },
          update: { failures: 1, window_started_at: now },
        });
      } else {
        await tx.loginThrottle.update({
          where: { key },
          data: { failures: { increment: 1 } },
        });
      }
    }
  });
  await sweepStaleThrottleRows(now);
}

export async function resetLoginThrottles(username: string, ip: string): Promise<void> {
  const keys = loginCounters(username, ip).map(([key]) => key);
  await prisma.loginThrottle.deleteMany({ where: { key: { in: keys } } });
}
