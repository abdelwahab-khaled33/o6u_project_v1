import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../lib/jwt.js', () => ({
  verifyToken: (token: string) => {
    if (token === 'good') return { userId: 'u-1', role: 'admin' };
    if (token === 'stale-admin') return { userId: 'u-1', role: 'admin' };
    throw new Error('bad token');
  },
}));

import type { Request } from 'express';
import { requireAuth, requireRoles } from './auth.js';

function call(handler: typeof requireAuth, token?: string) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as Request;
  const out = { status: 0, body: undefined as unknown, nextCalls: 0, err: undefined as unknown };
  // requireAuth answers synchronously on the two token failures and asynchronously
  // otherwise, so awaiting the handler's own return value would only work by accident of
  // microtask ordering. The promise settles on whichever comes first: next() or a json()
  // response. That makes every assertion below wait for the real outcome.
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const res = {
    status(n: number) {
      out.status = n;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      settle();
      return this;
    },
  };
  const next = (err?: unknown) => {
    out.nextCalls += 1;
    out.err = err;
    settle();
  };
  return {
    req,
    out,
    run: () => {
      handler(req, res as never, next);
      return done;
    },
  };
}

beforeEach(() => {
  prisma.user.findUnique.mockReset().mockResolvedValue({ id: 'u-1', role: 'admin', is_active: true });
});

// ---------------------------------------------------------------------------
// Finding 6a: the token is a statement about who signed in, not about what that
// person is still allowed to do. A JWT is valid for 8 hours, so a deactivated
// account or a demoted admin kept full access for the rest of that window.
// ---------------------------------------------------------------------------
describe('requireAuth re-reads the account on every request', () => {
  it('passes an active account through with the role the database holds', async () => {
    const { req, out, run } = call(requireAuth, 'good');
    await run();

    expect(out.nextCalls).toBe(1);
    expect(out.status).toBe(0);
    expect(req.auth).toEqual({ userId: 'u-1', role: 'admin' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { id: true, role: true, is_active: true },
    });
  });

  it('refuses a deactivated account on the very next request, not at token expiry', async () => {
    // Before the fix this account kept 200 on /subjects, /exams and /auth/me for up
    // to 8 hours. Only routes carrying a requirePermission key noticed, which is
    // why the deactivation looked like it had partially taken effect.
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'ta', is_active: false });
    const { out, run } = call(requireAuth, 'good');
    await run();

    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'Account is inactive' });
    expect(out.nextCalls).toBe(0);
  });

  it('uses the current database role, so a demotion takes effect at once', async () => {
    // The token still says admin for the rest of its 8h life. Before the fix,
    // requireRoles('admin') trusted that claim, so a demoted admin kept the entire
    // admin surface until the token expired.
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'ta', is_active: true });
    const { req, run } = call(requireAuth, 'stale-admin');
    await run();

    expect(req.auth?.role).toBe('ta');

    // The role guard, on the request requireAuth just populated, must now refuse.
    const out = { status: 0, body: undefined as unknown, nextCalls: 0 };
    requireRoles('admin')(
      req,
      {
        status(n: number) {
          out.status = n;
          return this;
        },
        json(b: unknown) {
          out.body = b;
          return this;
        },
      } as never,
      () => {
        out.nextCalls += 1;
      },
    );
    expect(out.status).toBe(403);
    expect(out.nextCalls).toBe(0);
  });

  it('never answers 401 for a deactivated account, which the client reads as a logout', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'admin', is_active: false });
    const { out, run } = call(requireAuth, 'good');
    await run();
    expect(out.status).not.toBe(401);
  });

  it('answers 401 when the account behind the token no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const { out, run } = call(requireAuth, 'good');
    await run();

    expect(out.status).toBe(401);
    expect(out.nextCalls).toBe(0);
  });

  it('still answers 401 for a missing or invalid token, without touching the database', async () => {
    const missing = call(requireAuth);
    await missing.run();
    expect(missing.out.status).toBe(401);
    expect(missing.out.body).toEqual({ error: 'Authentication required' });

    const bad = call(requireAuth, 'nope');
    await bad.run();
    expect(bad.out.status).toBe(401);
    expect(bad.out.body).toEqual({ error: 'Invalid or expired token' });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed through the error handler when the lookup itself fails', async () => {
    // A database blip must not become an authenticated request, and must not be
    // swallowed either: a swallowed rejection in an async middleware hangs forever.
    prisma.user.findUnique.mockRejectedValue(new Error('connection reset'));
    const { out, run } = call(requireAuth, 'good');
    await run();

    expect(out.nextCalls).toBe(1);
    expect(out.status).toBe(0);
    expect((out.err as Error).message).toBe('connection reset');
  });

  it('accepts a uuid-shaped role claim but takes the role from the row', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'student', is_active: true });
    const { req, run } = call(requireAuth, 'good');
    await run();
    expect(req.auth?.role).toBe('student');
  });
});
