import { describe, expect, it, vi } from 'vitest';

type Mock = ReturnType<typeof vi.fn>;
type MockModel = Record<string, Mock>;
type MockDb = Record<string, MockModel>;

const { prisma, transact } = vi.hoisted(() => {
  const transact = vi.fn((ops: unknown) => Promise.resolve(ops));
  const models = {} as Record<string, MockModel | Mock>;
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
  models['$transaction'] = transact;
  return { prisma: db as unknown as MockDb, transact };
});

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = { userId: 'aaaaaaaa-1111-4111-8111-111111111111', role: 'admin' };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRoles: () => (_req: unknown, _res: unknown, next: () => void): void => next(),
}));

import express from 'express';
import request from 'supertest';
import { adminRouter } from './admin.js';
import { buildDefaultPermissionRows } from '../services/admin-management.js';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

describe('POST /admin/permissions/defaults/reset', () => {
  it('restores the 72-row seed rectangle in one transaction', async () => {
    const response = await request(app).post('/api/v1/admin/permissions/defaults/reset').send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reset: true, defaults_restored: 72 });
    expect(transact).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-empty body', async () => {
    const response = await request(app).post('/api/v1/admin/permissions/defaults/reset').send({ reset: true });
    expect(response.status).toBe(400);
  });
});

describe('buildDefaultPermissionRows', () => {
  it('builds one row per role and key with the seed value', () => {
    const rows = buildDefaultPermissionRows();
    expect(rows).toHaveLength(72);
    const at = (role: string, key: string) => rows.find((row) => row.role === role && row.permission_key === key)?.allowed;
    expect(at('admin', 'users.manage')).toBe(true);
    expect(at('doctor', 'exam.create')).toBe(true);
    expect(at('ta', 'quiz.create')).toBe(true);
    expect(at('student', 'exam.take')).toBe(true);
    expect(at('student', 'users.manage')).toBe(false);
    expect(at('admin', 'exam.take')).toBe(false);
    expect(at('ta', 'grades.adjust')).toBe(false);
    expect(rows.filter((row) => row.allowed)).toHaveLength(30);
  });
});
