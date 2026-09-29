import { beforeEach, describe, expect, it, vi } from 'vitest';

type Mock = ReturnType<typeof vi.fn>;
type MockModel = Record<string, Mock>;
// The models this file actually touches are spelled out rather than left to an index
// signature, because under noUncheckedIndexedAccess `Record<string, Mock>` types every
// access as possibly undefined and every assertion below would need a cast just to
// satisfy the compiler.
type MockUserModel = {
  findUnique: Mock;
  findMany: Mock;
  count: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
};
type MockDb = Record<string, MockModel> & { user: MockUserModel };

const { prisma, authRef } = vi.hoisted(() => {
  // admin.ts reaches a dozen models. A hand-written mock that misses one fails at import
  // time with a null-ish property error, which reads like a real failure and is not one.
  // This hands back a stable vi.fn() per model+method so assertions still work, and each
  // model is memoised too so `prisma.user` keeps identity across calls.
  const models: Record<string, MockModel> = {};
  const db = new Proxy(models, {
    get(target, property: string) {
      const existing = target[property];
      if (existing) return existing;

      const methods: MockModel = {};
      target[property] = new Proxy(methods, {
        get(modelTarget, method: string) {
          const found = modelTarget[method];
          if (found) return found;
          const created = vi.fn();
          modelTarget[method] = created;
          return created;
        },
      });
      return target[property];
    },
  });
  // The proxy answers for every model dynamically, so the shape is declared in exactly one
  // place -- MockDb above -- rather than restated per model in the mock literal.
  const prisma = db as unknown as MockDb;
  return { prisma, authRef: { current: null as { userId: string; role: string } | null } };
});

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = authRef.current;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRoles: () => (_req: unknown, _res: unknown, next: () => void): void => next(),
}));

import express from 'express';
import request from 'supertest';
import { adminRouter } from './admin.js';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

const ACTOR = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222';

const userRow = (over: Record<string, unknown> = {}) => ({
  id: ACTOR,
  username: 'admin',
  full_name: 'The Admin',
  role: 'admin',
  is_active: true,
  student_code: null,
  can_change_password: true,
  ...over,
});

beforeEach(() => {
  authRef.current = { userId: ACTOR, role: 'admin' };
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(userRow());
  prisma.user.update.mockResolvedValue(userRow());
  prisma.user.count.mockResolvedValue(5);
});

describe('PATCH /admin/users/:id — the last active admin', () => {
  // Deactivating or demoting the only admin leaves nobody able to reach any admin route,
  // including the permissions screen that could undo it. Recovery is a direct database
  // edit. The permissions screen has the same guard (selfLockoutError); this is its
  // equivalent for the two fields that decide whether you are an admin at all.
  it('refuses to deactivate the requesting admin when they are the only active one', async () => {
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).patch(`/api/v1/admin/users/${ACTOR}`).send({ is_active: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to demote the requesting admin when they are the only active one', async () => {
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).patch(`/api/v1/admin/users/${ACTOR}`).send({ role: 'doctor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows deactivating yourself when another active admin exists', async () => {
    prisma.user.count.mockResolvedValue(2);

    const res = await request(app).patch(`/api/v1/admin/users/${ACTOR}`).send({ is_active: false });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('allows demoting yourself when another active admin exists', async () => {
    prisma.user.count.mockResolvedValue(2);

    const res = await request(app).patch(`/api/v1/admin/users/${ACTOR}`).send({ role: 'doctor' });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('refuses to demote another admin when they are the only active one left', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ id: OTHER, username: 'other-admin' }));
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).patch(`/api/v1/admin/users/${OTHER}`).send({ role: 'student' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to deactivate another admin when they are the only active one left', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ id: OTHER, username: 'other-admin' }));
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).patch(`/api/v1/admin/users/${OTHER}`).send({ is_active: false });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows a rename of the last admin, which cannot lock anyone out', async () => {
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .patch(`/api/v1/admin/users/${ACTOR}`)
      .send({ full_name: 'Renamed Admin' });

    expect(res.status).toBe(200);
  });

  it('allows a student_code change on the last admin', async () => {
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .patch(`/api/v1/admin/users/${ACTOR}`)
      .send({ student_code: 'X-1' });

    expect(res.status).toBe(200);
  });

  it('fires the guard on the role change when both fields are sent together', async () => {
    // Demoting self while staying active leaves exactly the same single active admin,
    // so the guard must trigger on the role change even though is_active was untouched.
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .patch(`/api/v1/admin/users/${ACTOR}`)
      .send({ role: 'ta', is_active: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active admin/i);
  });

  it('does not run the guard for a non-admin target', async () => {
    prisma.user.findUnique.mockResolvedValue(
      userRow({ id: OTHER, username: 'stu', role: 'student' }),
    );
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app).patch(`/api/v1/admin/users/${OTHER}`).send({ is_active: false });

    expect(res.status).toBe(200);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('does not run the guard for an unknown user, which is a 404 first', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).patch(`/api/v1/admin/users/${OTHER}`).send({ is_active: false });

    expect(res.status).toBe(404);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('still 404s a malformed id before the guard', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/not-a-uuid')
      .send({ is_active: false });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('asks the database for a count scoped to active admins', async () => {
    prisma.user.count.mockResolvedValue(2);

    await request(app).patch(`/api/v1/admin/users/${ACTOR}`).send({ is_active: false });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'admin', is_active: true },
    });
  });
});
