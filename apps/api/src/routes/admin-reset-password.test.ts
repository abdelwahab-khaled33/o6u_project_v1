import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findUnique: vi.fn() },
    passwordResetAudit: { create: vi.fn() },
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

import express from 'express';
import request from 'supertest';
import { adminRouter } from './admin.js';
import { signToken } from '../lib/jwt.js';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

const ADMIN = { id: 'admin-1', role: 'admin' as const, is_active: true };
const token = signToken(ADMIN.id, ADMIN.role);
const TARGET = '11111111-1111-4111-8111-111111111111';

const resetPassword = (id: string, body: Record<string, string>, auth = token) =>
  request(app).post(`/api/v1/admin/users/${id}/reset-password`).set('Authorization', `Bearer ${auth}`).send(body);

beforeEach(() => {
  for (const model of [prisma.user, prisma.permission, prisma.userPermissionOverride]) {
    for (const fn of Object.values(model)) (fn as { mockReset: () => void }).mockReset();
  }
  prisma.passwordResetAudit.create.mockReset();
  prisma.loginThrottle.findUnique.mockReset();
  prisma.loginThrottle.upsert.mockReset();
  prisma.loginThrottle.update.mockReset();
  prisma.loginThrottle.deleteMany.mockReset();
  prisma.$transaction.mockReset();
  // Both transaction forms the code under test uses: the interactive callback the
  // throttle counters take, and the array batch the password reset takes.
  prisma.$transaction.mockImplementation((payload: unknown) =>
    Array.isArray(payload) ? Promise.resolve(payload) : (payload as (tx: unknown) => unknown)(prisma),
  );
  prisma.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
    if (where.id === ADMIN.id) return Promise.resolve(ADMIN);
    if (where.id === TARGET) return Promise.resolve({ id: TARGET });
    return Promise.resolve(null);
  });
  prisma.permission.findUnique.mockResolvedValue({ allowed: true });
  prisma.userPermissionOverride.findUnique.mockResolvedValue(null);
  prisma.loginThrottle.findUnique.mockResolvedValue(null);
  prisma.loginThrottle.deleteMany.mockResolvedValue({ count: 0 });
  prisma.user.update.mockResolvedValue({ id: TARGET });
  prisma.passwordResetAudit.create.mockResolvedValue({ id: 'audit-1' });
});

describe('POST /admin/users/:id/reset-password throttle and audit', () => {
  it('resets the password and writes the audit row', async () => {
    const res = await resetPassword(TARGET, { new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.passwordResetAudit.create).toHaveBeenCalledTimes(1);
    expect(prisma.passwordResetAudit.create).toHaveBeenCalledWith({
      data: { admin_id: ADMIN.id, target_user_id: TARGET },
    });
  });

  it('answers 429 with Retry-After once the hourly budget is spent, changing nothing', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue({
      key: 'k',
      failures: 11,
      window_started_at: new Date(),
      updated_at: new Date(),
    });
    const res = await resetPassword(TARGET, { new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.passwordResetAudit.create).not.toHaveBeenCalled();
  });

  it('writes no audit row for an unknown target', async () => {
    const res = await resetPassword('22222222-2222-4222-8222-222222222222', { new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(404);
    expect(prisma.passwordResetAudit.create).not.toHaveBeenCalled();
  });

  it('changes the password and writes the audit row in one transaction', async () => {
    // Two independent awaits would leave the worst state reachable: the password
    // is changed but the audit row is not, so an admin reset nobody can trace.
    // A Prisma array transaction is the only shape that makes them one unit.
    prisma.$transaction.mockClear();
    const res = await resetPassword(TARGET, { new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(200);
    const batches = prisma.$transaction.mock.calls.filter(([payload]) => Array.isArray(payload));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toHaveLength(2);
  });

  it('surfaces a failed audit write rather than reporting a reset that cannot be traced', async () => {
    // The mock cannot emulate a rollback, so this pins the two things that make a
    // rollback possible at all: both writes reach $transaction together, and a
    // rejection there is not swallowed into a 200.
    const batches: unknown[] = [];
    prisma.$transaction.mockImplementation((payload: unknown) => {
      batches.push(payload);
      if (Array.isArray(payload)) return Promise.reject(new Error('audit table unavailable'));
      return Promise.resolve([]);
    });
    const res = await resetPassword(TARGET, { new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(500);
    expect(batches.some(Array.isArray)).toBe(true);
  });

  it('does not read throttle counters for a malformed body', async () => {
    const res = await resetPassword(TARGET, { new_password: 'short' });
    expect(res.status).toBe(400);
    expect(prisma.loginThrottle.findUnique).not.toHaveBeenCalled();
    expect(prisma.passwordResetAudit.create).not.toHaveBeenCalled();
  });
});
