import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  prisma: {
    exam: { findUnique: vi.fn() },
    subject: { findUnique: vi.fn() },
    gradeAdjustment: { findMany: vi.fn() },
    section: { findMany: vi.fn() },
    studentExam: { findMany: vi.fn() },
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
import { gradeAdjustmentsRouter } from './grade-adjustments.js';
import { resultsRouter } from './results.js';

const app = express();
app.use(express.json());
app.use('/grade-adjustments', gradeAdjustmentsRouter);
app.use('/results', resultsRouter);

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const MALFORMED = 'not-a-uuid';
const UNKNOWN_BUT_VALID = '00000000-0000-4000-8000-000000000000';

beforeEach(() => {
  vi.clearAllMocks();
  authRef.current = { userId: DOCTOR, role: 'doctor' };
  prisma.exam.findUnique.mockResolvedValue(null);
  prisma.subject.findUnique.mockResolvedValue(null);
});

describe('a malformed path id is a 404 and must never reach Prisma', () => {
  it('GET /grade-adjustments/exams/:examId/adjustments', async () => {
    const res = await request(app).get(`/grade-adjustments/exams/${MALFORMED}/adjustments`);

    expect(res.status).toBe(404);
    // The whole point: Prisma throws P2023 on a non-uuid, which used to become a 500.
    // If the handler ever reaches Prisma again this assertion fails, not just the status.
    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
    expect(prisma.gradeAdjustment.findMany).not.toHaveBeenCalled();
  });

  it('POST /grade-adjustments/exams/:examId/compensate', async () => {
    const res = await request(app)
      .post(`/grade-adjustments/exams/${MALFORMED}/compensate`)
      .send({
        source_question_id: UNKNOWN_BUT_VALID,
        adjustment_type: 'full_credit',
        reason: 'a perfectly valid reason',
      });

    expect(res.status).toBe(404);
    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
  });

  it('GET /results/subjects/:subjectId', async () => {
    const res = await request(app).get(`/results/subjects/${MALFORMED}`);

    expect(res.status).toBe(404);
    expect(prisma.subject.findUnique).not.toHaveBeenCalled();
  });

  it('GET /results/export with a malformed subject_id', async () => {
    const res = await request(app).get(`/results/export?subject_id=${MALFORMED}&scope=all`);

    expect(res.status).toBe(404);
    expect(prisma.subject.findUnique).not.toHaveBeenCalled();
  });

  it('GET /results/export with a malformed exam id inside scope', async () => {
    // The subject must resolve, otherwise the route 404s on the subject before it ever
    // looks at the exam id and the assertion below would pass for the wrong reason.
    prisma.subject.findUnique.mockResolvedValue({ id: UNKNOWN_BUT_VALID, code: 'X', name: 'X' });

    const res = await request(app).get(
      `/results/export?subject_id=${UNKNOWN_BUT_VALID}&scope=exam:${MALFORMED}`,
    );

    expect(res.status).toBe(404);
    expect(prisma.subject.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
  });
});

describe('a well-formed id is untouched: it still reaches Prisma and 404s on no match', () => {
  it('a valid but unknown exam id reaches Prisma and answers 404', async () => {
    const res = await request(app).get(`/grade-adjustments/exams/${UNKNOWN_BUT_VALID}/adjustments`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exam not found' });
    expect(prisma.exam.findUnique).toHaveBeenCalledTimes(1);
  });

  it('a valid but unknown subject id reaches Prisma and answers 404', async () => {
    const res = await request(app).get(`/results/subjects/${UNKNOWN_BUT_VALID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Subject not found' });
    expect(prisma.subject.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('the guard must not swallow an unrelated 400', () => {
  // Adding the uuid check ahead of the scope check would have quietly turned this
  // 400 into a 404, which is a worse message and a behaviour change nobody asked for.
  it('a malformed subject_id AND a malformed scope still reports the scope', async () => {
    const res = await request(app).get(`/results/export?subject_id=${MALFORMED}&scope=bogus`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid scope');
    expect(prisma.subject.findUnique).not.toHaveBeenCalled();
  });

  it('a missing subject_id is still 400 even though it is also not a uuid', async () => {
    const res = await request(app).get('/results/export?scope=all');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'subject_id is required' });
  });
});

describe('a well-formed id that resolves is not blocked by the guard', () => {
  it('passes a resolved exam through to the real handler', async () => {
    prisma.exam.findUnique.mockResolvedValue({
      id: UNKNOWN_BUT_VALID,
      type: 'doctor_exam',
      owner_id: DOCTOR,
      subject_id: UNKNOWN_BUT_VALID,
    });
    prisma.gradeAdjustment.findMany.mockResolvedValue([]);

    const res = await request(app).get(`/grade-adjustments/exams/${UNKNOWN_BUT_VALID}/adjustments`);

    expect(res.status).toBe(200);
    expect(prisma.gradeAdjustment.findMany).toHaveBeenCalledTimes(1);
  });
});
