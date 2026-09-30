import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /exams/:id/resubmit moves a rejected exam back to pending_approval.
 *
 * A rejected exam used to be a permanent dead end: admin-exams.ts refuses to
 * approve anything that is not pending_approval, and the only transition into
 * pending_approval was a doctor editing an APPROVED exam. The only way out was
 * delete-and-recreate, which loses the attempt history.
 */

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  prisma: {
    exam: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = authRef.current;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRoles:
    (...roles: string[]) =>
    (req: { auth?: { role: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      if (!req.auth || !roles.includes(req.auth.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    },
}));

import express from 'express';
import request from 'supertest';
import { examsRouter } from './exams.js';

const app = express();
app.use(express.json());
app.use('/exams', examsRouter);

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const OTHER_DOCTOR = '33333333-3333-4333-8333-333333333333';
const TA = '44444444-4444-4444-8444-444444444444';
const EXAM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALFORMED = 'not-a-uuid';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

function examRow(ownerId: string, status: string) {
  return { id: EXAM, type: 'doctor_exam', owner_id: ownerId, subject_id: SUBJECT, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  authRef.current = { userId: DOCTOR, role: 'doctor' };
  prisma.exam.findUnique.mockResolvedValue(null);
  prisma.exam.update.mockResolvedValue({ id: EXAM, status: 'pending_approval', rejection_reason: null });
  prisma.user.findUnique.mockResolvedValue({ is_active: true });
  prisma.permission.findUnique.mockImplementation(() => ({ allowed: true }));
  prisma.userPermissionOverride.findUnique.mockResolvedValue(null);
});

describe('POST /exams/:id/resubmit', () => {
  it('moves an owner doctor rejected exam back to pending_approval and clears the rejection reason', async () => {
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(200);
    expect(res.body.exam.status).toBe('pending_approval');
    expect(prisma.exam.update).toHaveBeenCalledTimes(1);
    expect(prisma.exam.update.mock.calls[0]?.[0]?.data).toEqual({
      status: 'pending_approval',
      rejection_reason: null,
    });
  });

  it('rejects a body the route takes no input from', async () => {
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`).send({ reason: 'junk' });

    expect(res.status).toBe(400);
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 409 for an approved exam', async () => {
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'approved'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Only rejected exams can be resubmitted' });
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 409 for a pending_approval exam', async () => {
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'pending_approval'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(409);
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 403 for a doctor who does not own the exam', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You do not own this exam' });
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 403 before 409 for a doctor with no claim on a non-rejected exam', async () => {
    // Authorization before state: an unauthorized caller must not learn from the
    // answer whether the exam exists in a resubmittable state.
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'approved'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(403);
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown exam', async () => {
    const res = await request(app).post(`/exams/${UNKNOWN}/resubmit`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exam not found' });
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed id without reaching Prisma', async () => {
    const res = await request(app).post(`/exams/${MALFORMED}/resubmit`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exam not found' });
    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('lets an admin resubmit another owner rejected exam', async () => {
    authRef.current = { userId: ADMIN, role: 'admin' };
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(200);
    expect(res.body.exam.status).toBe('pending_approval');
    expect(prisma.exam.update).toHaveBeenCalledTimes(1);
  });

  it('refuses an admin without exams.manage_all on another owner exam', async () => {
    authRef.current = { userId: ADMIN, role: 'admin' };
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));
    prisma.permission.findUnique.mockImplementation(({ where }: { where: { role_permission_key: { permission_key: string } } }) =>
      where.role_permission_key.permission_key === 'exams.manage_all' ? { allowed: false } : { allowed: true },
    );

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(403);
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('refuses a doctor without the exam permission', async () => {
    prisma.exam.findUnique.mockResolvedValue(examRow(DOCTOR, 'rejected'));
    prisma.permission.findUnique.mockResolvedValue({ allowed: false });

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Insufficient permissions' });
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('refuses a TA without reaching the database', async () => {
    authRef.current = { userId: TA, role: 'ta' };

    const res = await request(app).post(`/exams/${EXAM}/resubmit`);

    expect(res.status).toBe(403);
    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });
});
