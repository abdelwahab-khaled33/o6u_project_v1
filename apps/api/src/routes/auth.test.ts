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

const HASH = bcrypt.hashSync('Passw0rd!23', 10);

const login = (username: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ username, password });

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
});

describe('POST /login response shape', () => {
  it('gives the same 401 for an unknown username as for a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const unknown = await login('nobody-here', 'Passw0rd!23');

    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      username: 'real',
      full_name: 'Real User',
      role: 'student',
      can_change_password: false,
      is_active: true,
      password_hash: HASH,
    });
    const wrong = await login('real', 'wrong-password');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('gives the same 401 for an inactive account as for an unknown one', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      username: 'real',
      full_name: 'Real User',
      role: 'student',
      can_change_password: false,
      is_active: false,
      password_hash: HASH,
    });

    const inactive = await login('real', 'Passw0rd!23');
    prisma.user.findUnique.mockResolvedValue(null);
    const unknown = await login('nobody-here', 'Passw0rd!23');

    expect(inactive.status).toBe(401);
    expect(inactive.body).toEqual(unknown.body);
  });

  it('never issues a token for a missing or inactive account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await login('nobody-here', 'Passw0rd!23');

    expect(res.body).not.toHaveProperty('token');
  });
});

describe('POST /login does not leak existence through response time', () => {
  // bcrypt.compare is the expensive part of the handler (~100ms). Returning before it for
  // an unknown username makes the endpoint a free username oracle: enumerate the roll,
  // then attack only the accounts that exist. A timing assertion is inherently noisy, so
  // this is written as a spy on the primitive -- it fails for certain with an early
  // return, and does not depend on a wall-clock threshold that CI could flake on.
  it('still performs a password comparison when the username does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const spy = vi.spyOn(bcrypt, 'compare');

    await login('nobody-here', 'Passw0rd!23');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still performs a password comparison when the account is inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      username: 'real',
      full_name: 'Real User',
      role: 'student',
      can_change_password: false,
      is_active: false,
      password_hash: HASH,
    });
    const spy = vi.spyOn(bcrypt, 'compare');

    await login('real', 'Passw0rd!23');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('compares against a real hash so the work performed is the same shape', async () => {
    // If the decoy hash were shorter or malformed, bcrypt.compare would return early and
    // the timing would be identical to the early-return bug this is closing.
    prisma.user.findUnique.mockResolvedValue(null);
    const spy = vi.spyOn(bcrypt, 'compare');

    await login('nobody-here', 'Passw0rd!23');

    const hash = spy.mock.calls.at(-1)?.[1] as string;
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    spy.mockRestore();
  });

  it('does not compare a password the schema already rejected', async () => {
    // A 400 for a missing field is not an authentication attempt, so burning 100ms of
    // bcrypt on it would be a free denial-of-service surface.
    prisma.user.findUnique.mockResolvedValue(null);
    const spy = vi.spyOn(bcrypt, 'compare');

    await request(app).post('/api/v1/auth/login').send({ username: 'nobody-here' });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
