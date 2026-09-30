import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    loginThrottle: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

import {
  LOGIN_ACCOUNT_THROTTLE,
  LOGIN_IP_THROTTLE,
  LOGIN_PAIR_THROTTLE,
  PASSWORD_CHANGE_THROTTLE,
  PASSWORD_RESET_THROTTLE,
  checkLoginThrottles,
  delayForFailures,
  loginAccountKey,
  loginIpKey,
  loginPairKey,
  recordLoginFailures,
  resetLoginThrottles,
} from './login-throttle.js';

beforeEach(() => {
  prisma.loginThrottle.findMany.mockReset();
  prisma.loginThrottle.findUnique.mockReset();
  prisma.loginThrottle.upsert.mockReset();
  prisma.loginThrottle.update.mockReset();
  prisma.loginThrottle.deleteMany.mockReset();
  prisma.$transaction.mockReset();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.loginThrottle.findMany.mockResolvedValue([]);
  prisma.loginThrottle.deleteMany.mockResolvedValue({ count: 0 });
});

describe('throttle keys', () => {
  it('is deterministic for the same username and ip', () => {
    expect(loginPairKey('student1', '10.0.0.5')).toBe(loginPairKey('student1', '10.0.0.5'));
  });

  it('treats username case as the same key so case rotation opens no fresh counter', () => {
    expect(loginPairKey('Student1', '10.0.0.5')).toBe(loginPairKey('student1', '10.0.0.5'));
    expect(loginAccountKey('Student1')).toBe(loginAccountKey('student1'));
  });

  it('holds a hash, never the username or ip in plaintext', () => {
    const pair = loginPairKey('student1', '10.0.0.5');
    const ip = loginIpKey('10.0.0.5');
    const account = loginAccountKey('student1');
    for (const key of [pair, ip, account]) {
      expect(key).not.toContain('student1');
      expect(key).not.toContain('10.0.0.5');
    }
  });

  it('separates scopes so a pair counter never collides with an ip counter', () => {
    expect(loginPairKey('x', 'y')).not.toBe(loginIpKey('y'));
    expect(loginPairKey('x', 'y')).not.toBe(loginAccountKey('x'));
    expect(new Set([loginPairKey('a', 'b'), loginIpKey('b'), loginAccountKey('a')]).size).toBe(3);
  });
});

describe('delayForFailures', () => {
  it('is zero while failures stay within the free budget', () => {
    expect(delayForFailures(0, LOGIN_PAIR_THROTTLE)).toBe(0);
    expect(delayForFailures(5, LOGIN_PAIR_THROTTLE)).toBe(0);
  });

  it('escalates exponentially from the base delay past the budget', () => {
    expect(delayForFailures(6, LOGIN_PAIR_THROTTLE)).toBe(30);
    expect(delayForFailures(7, LOGIN_PAIR_THROTTLE)).toBe(60);
    expect(delayForFailures(8, LOGIN_PAIR_THROTTLE)).toBe(120);
  });

  it('caps instead of locking out', () => {
    expect(delayForFailures(1000, LOGIN_PAIR_THROTTLE)).toBe(900);
    expect(delayForFailures(1000, LOGIN_IP_THROTTLE)).toBe(900);
    expect(delayForFailures(1000, LOGIN_ACCOUNT_THROTTLE)).toBe(900);
  });

  it('never escalates the two password specs, whatever the failure count', () => {
    // Their stepEvery used to read 1000000, a number doing nothing except
    // silently changing the delay if maxDelaySec were ever raised above the base.
    // Both specs have base === max, so stepEvery cannot matter, and the honest
    // value is 1. This pins the flat behaviour so the invariant cannot rot.
    for (const spec of [PASSWORD_CHANGE_THROTTLE, PASSWORD_RESET_THROTTLE]) {
      expect(delayForFailures(spec.maxFree, spec)).toBe(0);
      for (const failures of [spec.maxFree + 1, spec.maxFree + 2, spec.maxFree + 50, 100000]) {
        expect(delayForFailures(failures, spec)).toBe(3600);
      }
    }
  });
});

describe('checkLoginThrottles', () => {
  it('is not throttled when no counter exists', async () => {
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(false);
    expect(result.retryAfterSec).toBe(0);
  });

  it('reads all three counters in one query', async () => {
    await checkLoginThrottles('student1', '10.0.0.5');
    expect(prisma.loginThrottle.findMany).toHaveBeenCalledTimes(1);
    const keys = prisma.loginThrottle.findMany.mock.calls[0]?.[0]?.where?.key?.in as string[];
    expect(keys).toContain(loginPairKey('student1', '10.0.0.5'));
    expect(keys).toContain(loginIpKey('10.0.0.5'));
    expect(keys).toContain(loginAccountKey('student1'));
  });

  it('throttles on the pair counter with the pair delay', async () => {
    prisma.loginThrottle.findMany.mockResolvedValue([
      {
        key: loginPairKey('student1', '10.0.0.5'),
        failures: 6,
        window_started_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(true);
    expect(result.retryAfterSec).toBe(30);
  });

  it('lets one attempt through once the delay has passed since the last attempt', async () => {
    prisma.loginThrottle.findMany.mockResolvedValue([
      {
        key: loginPairKey('student1', '10.0.0.5'),
        failures: 6,
        window_started_at: new Date(),
        updated_at: new Date(Date.now() - 31 * 1000),
      },
    ]);
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(false);
  });

  it('keeps throttling inside the delay since the last attempt', async () => {
    prisma.loginThrottle.findMany.mockResolvedValue([
      {
        key: loginPairKey('student1', '10.0.0.5'),
        failures: 6,
        window_started_at: new Date(),
        updated_at: new Date(Date.now() - 29 * 1000),
      },
    ]);
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(true);
    expect(result.retryAfterSec).toBe(30);
  });

  it('ignores a counter whose window has expired', async () => {
    prisma.loginThrottle.findMany.mockResolvedValue([
      {
        key: loginPairKey('student1', '10.0.0.5'),
        failures: 500,
        window_started_at: new Date(Date.now() - 20 * 60 * 1000),
        updated_at: new Date(Date.now() - 20 * 60 * 1000),
      },
    ]);
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(false);
  });

  it('answers with the worst of the three counters', async () => {
    prisma.loginThrottle.findMany.mockResolvedValue([
      {
        key: loginPairKey('student1', '10.0.0.5'),
        failures: 6,
        window_started_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: loginIpKey('10.0.0.5'),
        failures: 65,
        window_started_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const result = await checkLoginThrottles('student1', '10.0.0.5');
    expect(result.throttled).toBe(true);
    expect(result.retryAfterSec).toBe(120);
  });
});

describe('recordLoginFailures', () => {
  it('records exactly the counters the gate checks', async () => {
    // The check and the record are two functions holding two lists of the same
    // three counters. Add a fourth to one and a 429 can name a key the gate never
    // reads, or a counter can climb that nothing ever tests -- a silently dead
    // limiter. This asserts the two lists are the same list, so the duplication
    // can be reintroduced only along with this failing.
    prisma.loginThrottle.findMany.mockResolvedValue([]);
    prisma.loginThrottle.findUnique.mockResolvedValue(null);
    await checkLoginThrottles('student1', '10.0.0.5');
    const checked = (prisma.loginThrottle.findMany.mock.calls[0]?.[0] as { where: { key: { in: string[] } } }).where.key.in;
    await recordLoginFailures('student1', '10.0.0.5');
    const recorded = prisma.loginThrottle.upsert.mock.calls.map(
      (call) => (call[0] as { where: { key: string } }).where.key,
    );
    expect([...recorded].sort()).toEqual([...checked].sort());
  });

  it('sweeps stale rows once per login failure, not once per counter', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue(null);
    await recordLoginFailures('student1', '10.0.0.5');
    const sweeps = prisma.loginThrottle.deleteMany.mock.calls.filter(
      (call) => (call[0] as { where?: { updated_at?: unknown } }).where?.updated_at !== undefined,
    );
    expect(sweeps).toHaveLength(1);
  });

  it('creates or bumps all three counters inside a transaction', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue(null);
    await recordLoginFailures('student1', '10.0.0.5');
    // One transaction for all three, not one each: a failure that bumped the pair
    // counter and then failed to commit the account counter would leave the
    // account under-counted and the next attempt would sail past the limit.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.loginThrottle.upsert).toHaveBeenCalledTimes(3);
  });

  it('increments a live counter instead of resetting it', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue({
      key: 'k',
      failures: 4,
      window_started_at: new Date(),
      updated_at: new Date(),
    });
    await recordLoginFailures('student1', '10.0.0.5');
    expect(prisma.loginThrottle.update).toHaveBeenCalledTimes(3);
    expect(prisma.loginThrottle.upsert).not.toHaveBeenCalled();
  });

  it('restarts a counter whose window has expired', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue({
      key: 'k',
      failures: 500,
      window_started_at: new Date(Date.now() - 20 * 60 * 1000),
      updated_at: new Date(Date.now() - 20 * 60 * 1000),
    });
    await recordLoginFailures('student1', '10.0.0.5');
    expect(prisma.loginThrottle.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.loginThrottle.update).not.toHaveBeenCalled();
  });
});

describe('resetLoginThrottles', () => {
  it('deletes all three counters so a success clears failures', async () => {
    await resetLoginThrottles('student1', '10.0.0.5');
    expect(prisma.loginThrottle.deleteMany).toHaveBeenCalledTimes(1);
    const keys = prisma.loginThrottle.deleteMany.mock.calls[0]?.[0]?.where?.key?.in as string[];
    expect(keys).toContain(loginPairKey('student1', '10.0.0.5'));
    expect(keys).toContain(loginIpKey('10.0.0.5'));
    expect(keys).toContain(loginAccountKey('student1'));
  });
});
