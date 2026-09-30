import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findUnique: vi.fn() },
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
import { authRouter } from './auth.js';
import { signToken } from '../lib/jwt.js';

const app = express();
app.use(express.json());
app.use('/api/v1/auth', authRouter);

const HASH = bcrypt.hashSync('Passw0rd!23', 10);
const STAFF = {
  id: 'staff-1',
  username: 'doc1',
  full_name: 'Doc One',
  role: 'doctor' as const,
  can_change_password: true,
  is_active: true,
  password_hash: HASH,
};
const token = signToken(STAFF.id, STAFF.role);

const changePassword = (body: Record<string, string>, auth = token) =>
  request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${auth}`).send(body);

beforeEach(() => {
  for (const model of [prisma.user, prisma.permission, prisma.userPermissionOverride]) {
    for (const fn of Object.values(model)) (fn as { mockReset: () => void }).mockReset();
  }
  prisma.loginThrottle.findMany.mockReset();
  prisma.loginThrottle.findUnique.mockReset();
  prisma.loginThrottle.upsert.mockReset();
  prisma.loginThrottle.update.mockReset();
  prisma.loginThrottle.deleteMany.mockReset();
  prisma.$transaction.mockReset();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.user.findUnique.mockResolvedValue(STAFF);
  prisma.permission.findUnique.mockResolvedValue({ allowed: true });
  prisma.userPermissionOverride.findUnique.mockResolvedValue(null);
  prisma.loginThrottle.findUnique.mockResolvedValue(null);
  prisma.loginThrottle.deleteMany.mockResolvedValue({ count: 0 });
});

describe('POST /change-password throttling', () => {
  it('changes the password and clears the counter on success', async () => {
    const res = await changePassword({ current_password: 'Passw0rd!23', new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.loginThrottle.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('records a wrong current password and keeps the 400 shape', async () => {
    const res = await changePassword({ current_password: 'wrong', new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Current password is incorrect' });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('answers 429 with Retry-After once the hourly budget is spent', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue({
      key: 'k',
      failures: 6,
      window_started_at: new Date(),
      updated_at: new Date(),
    });
    const res = await changePassword({ current_password: 'wrong', new_password: 'NewPassw0rd!1' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not burn bcrypt on a throttled request', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue({
      key: 'k',
      failures: 6,
      window_started_at: new Date(),
      updated_at: new Date(),
    });
    const spy = vi.spyOn(bcrypt, 'compare');
    await changePassword({ current_password: 'wrong', new_password: 'NewPassw0rd!1' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
