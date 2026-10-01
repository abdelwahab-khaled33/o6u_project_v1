import { beforeEach, describe, expect, it, vi } from 'vitest';

type Mock = ReturnType<typeof vi.fn>;
type MockModel = Record<string, Mock>;
type MockFindModel = { findUnique: Mock; findMany: Mock };
type MockDb = Record<string, MockModel> & {
  user: MockFindModel;
  enrollment: { findMany: Mock };
  sectionMembership: { findMany: Mock };
};

const { prisma, authRef } = vi.hoisted(() => {
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
const STUDENT = '99999999-9999-4999-8999-999999999999';
const SUB_A = 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa';
const SUB_B = 'bbbbbbbb-bbbb-4222-8222-bbbbbbbbbbbb';
const SEC_A = 'a1a1a1a1-a1a1-4111-8111-a1a1a1a1a1a1';

beforeEach(() => {
  authRef.current = { userId: ACTOR, role: 'admin' };
  prisma.user.findUnique.mockReset().mockResolvedValue({ id: STUDENT, role: 'student' });
  prisma.enrollment.findMany.mockReset().mockResolvedValue([]);
  prisma.sectionMembership.findMany.mockReset().mockResolvedValue([]);
});

describe('GET /admin/enrollments/:studentId', () => {
  it('answers 404 for an unknown student without touching enrollments', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/v1/admin/enrollments/${STUDENT}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Student not found' });
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed id with the same message', async () => {
    const res = await request(app).get('/api/v1/admin/enrollments/not-a-uuid');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Student not found' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('answers 400 for a user who is not a student', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: STUDENT, role: 'doctor' });

    const res = await request(app).get(`/api/v1/admin/enrollments/${STUDENT}`);

    expect(res.status).toBe(400);
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('returns each enrolled subject with its section', async () => {
    prisma.enrollment.findMany.mockResolvedValue([
      { subject_id: SUB_A, subject: { id: SUB_A, code: 'CS81143', name: 'Subject A' } },
      { subject_id: SUB_B, subject: { id: SUB_B, code: 'SEC4938', name: 'Subject B' } },
    ]);
    prisma.sectionMembership.findMany.mockResolvedValue([
      { section: { id: SEC_A, name: 'Live Section A', subject_id: SUB_A } },
    ]);

    const res = await request(app).get(`/api/v1/admin/enrollments/${STUDENT}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      student_id: STUDENT,
      enrollments: [
        {
          subject: { id: SUB_A, code: 'CS81143', name: 'Subject A' },
          section: { id: SEC_A, name: 'Live Section A' },
        },
        {
          subject: { id: SUB_B, code: 'SEC4938', name: 'Subject B' },
          section: null,
        },
      ],
    });
  });
});
