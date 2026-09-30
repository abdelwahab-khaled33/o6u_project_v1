import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
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

const app = express();
app.use(express.json());
app.use('/api/v1/auth', authRouter);

// The handler keys counters by the socket peer supertest arrives on, so the
// mock answers for whatever keys are actually asked about instead of guessing
// the address format.
const allCountersAt = (failures: number) =>
  prisma.loginThrottle.findMany.mockImplementation(({ where }: { where: { key: { in: string[] } } }) =>
    Promise.resolve(
      where.key.in.map((key) => ({
        key,
        failures,
        window_started_at: new Date(),
        updated_at: new Date(),
      })),
    ),
  );

const HASH = bcrypt.hashSync('Passw0rd!23', 10);

const login = (username: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ username, password });

const activeUser = {
  id: 'u-1',
  username: 'real',
  full_name: 'Real User',
  role: 'student',
  can_change_password: false,
  is_active: true,
  password_hash: HASH,
};

beforeEach(() => {
  prisma.user.findUnique.mockReset();
  prisma.user.update.mockReset();
  prisma.loginThrottle.findMany.mockReset();
  prisma.loginThrottle.findUnique.mockReset();
  prisma.loginThrottle.upsert.mockReset();
  prisma.loginThrottle.update.mockReset();
  prisma.loginThrottle.deleteMany.mockReset();
  prisma.$transaction.mockReset();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.loginThrottle.findMany.mockResolvedValue([]);
  prisma.loginThrottle.deleteMany.mockResolvedValue({ count: 0 });
  prisma.user.findUnique.mockResolvedValue(activeUser);
});

describe('POST /login throttling', () => {
  it('answers 429 with Retry-After once the pair budget is spent', async () => {
    allCountersAt(6);
    const res = await login('real', 'Passw0rd!23');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('answers the identical 429 whether or not the username exists', async () => {
    allCountersAt(6);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await login('nobody-here', 'Passw0rd!23');

    allCountersAt(6);
    prisma.user.findUnique.mockResolvedValueOnce(activeUser);
    const known = await login('real', 'wrong-password');

    expect(unknown.status).toBe(429);
    expect(known.status).toBe(429);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.headers['retry-after']).toBe(known.headers['retry-after']);
  });

  it('does not burn bcrypt on a throttled request', async () => {
    allCountersAt(6);
    const spy = vi.spyOn(bcrypt, 'compare');
    await login('real', 'Passw0rd!23');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not read throttle counters for a malformed body', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'real' });
    expect(res.status).toBe(400);
    expect(prisma.loginThrottle.findMany).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('records the failure on a wrong password and keeps the 401 shape', async () => {
    prisma.loginThrottle.findUnique.mockResolvedValue(null);
    const res = await login('real', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('clears all three counters on a successful login', async () => {
    const res = await login('real', 'Passw0rd!23');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(prisma.loginThrottle.deleteMany).toHaveBeenCalledTimes(1);
    const keys = prisma.loginThrottle.deleteMany.mock.calls[0]?.[0]?.where?.key?.in as string[];
    expect(keys).toHaveLength(3);
  });
});
