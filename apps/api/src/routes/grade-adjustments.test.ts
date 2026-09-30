import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as subjectAccessModule from '../services/subject-access.js';

const { prisma, authRef, subjectDoctor, compensate } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  subjectDoctor: { current: false },
  compensate: vi.fn(),
  prisma: {
    exam: { findUnique: vi.fn() },
    gradeAdjustment: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../services/subject-access.js', async (importOriginal) => {
  const actual = await importOriginal<typeof subjectAccessModule>();
  return { ...actual, isDoctorOfSubject: () => Promise.resolve(subjectDoctor.current) };
});

vi.mock('../services/grade-adjustment.js', () => ({ applyGradeCompensation: compensate }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = authRef.current;
    next();
  },
  requireRoles: (...roles: string[]) => (req: { auth?: { role: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  },
  // The real requirePermission would hit resolvePermissionAccess, which needs a
  // permission matrix. Authorisation ordering is what these tests are about.
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { gradeAdjustmentsRouter, hasAtMostTwoDecimals } from './grade-adjustments.js';

const app = express();
app.use(express.json());
app.use('/grade-adjustments', gradeAdjustmentsRouter);

const DOCTOR = 'doc-1';
const OTHER_DOCTOR = 'doc-2';
const ADMIN = 'admin-1';
const EXAM = '00000000-0000-4000-8000-0000000000aa';
const QUESTION = '00000000-0000-4000-8000-0000000000bb';

const body = {
  source_question_id: QUESTION,
  adjustment_type: 'full_credit' as const,
  reason: 'printing defect',
};

function exam(row: Record<string, unknown> | null) {
  prisma.exam.findUnique.mockReset().mockResolvedValue(row);
}

const ownerExam = { id: EXAM, type: 'doctor_exam', owner_id: DOCTOR, subject_id: 'sub-1', status: 'approved' };

beforeEach(() => {
  authRef.current = { userId: DOCTOR, role: 'doctor' };
  subjectDoctor.current = false;
  compensate.mockReset().mockResolvedValue({ adjustmentCount: 2, totalGradeRecalculated: 2 });
  prisma.gradeAdjustment.findMany.mockReset().mockResolvedValue([]);
  exam(ownerExam);
});

// ---------------------------------------------------------------------------
// Finding 5: the 409 status gate ran BEFORE the ownership check, so an exam's
// existence and its approval state were disclosed to a doctor who has no claim
// on it. The sibling GET route has no status gate at all and checks ownership
// first, which is what the POST route must match.
// ---------------------------------------------------------------------------
describe('POST /grade-adjustments/exams/:id/compensate answers 403 before 409', () => {
  it('refuses a non-owning doctor on a PENDING exam with 403, not 409', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    exam({ ...ownerExam, status: 'pending_approval' });

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);

    // Before the fix this was 409 "Only approved exams can receive grade
    // adjustments", which told an unrelated doctor that this exam id exists and
    // what state it is in.
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You do not own this exam' });
  });

  it('refuses a non-owning doctor on a REJECTED exam with 403, not 409', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    exam({ ...ownerExam, status: 'rejected' });

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(res.status).toBe(403);
  });

  it('refuses a doctor who is not the subject doctor for a TA quiz, on a pending quiz', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    subjectDoctor.current = false;
    exam({ id: EXAM, type: 'ta_quiz', owner_id: 'ta-9', subject_id: 'sub-1', status: 'pending_approval' });

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You are not the doctor of this subject' });
  });

  it('never writes an adjustment for an unauthorized caller', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    exam({ ...ownerExam, status: 'pending_approval' });

    await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(compensate).not.toHaveBeenCalled();
  });

  it('still reaches the 409 for an authorized caller, so the gate is not simply gone', async () => {
    exam({ ...ownerExam, status: 'pending_approval' });

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Only approved exams can receive grade adjustments' });
    expect(compensate).not.toHaveBeenCalled();
  });

  it('agrees with the audit-trail sibling on who is refused', async () => {
    // The two routes must not disagree about ownership, or one of them leaks what
    // the other protects.
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    for (const status of ['pending_approval', 'approved', 'rejected']) {
      exam({ ...ownerExam, status });
      const post = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
      const get = await request(app).get(`/grade-adjustments/exams/${EXAM}/adjustments`);
      expect([status, post.status, get.status]).toEqual([status, 403, 403]);
    }
  });

  it('still 404s an unknown exam for everyone, since no row means no decision to make', async () => {
    authRef.current = { userId: OTHER_DOCTOR, role: 'doctor' };
    exam(null);

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exam not found' });
  });

  it('lets the owning doctor and an admin through, so the reorder is not a lockout', async () => {
    expect((await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body)).status).toBe(200);

    authRef.current = { userId: ADMIN, role: 'admin' };
    expect((await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body)).status).toBe(200);
    expect(compensate).toHaveBeenCalledTimes(2);
  });

  it('lets a doctor who owns the subject adjust a TA quiz on it', async () => {
    subjectDoctor.current = true;
    exam({ id: EXAM, type: 'ta_quiz', owner_id: 'ta-9', subject_id: 'sub-1', status: 'approved' });

    const res = await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Finding 7: `points` had no upper bound. The column is Decimal(6,2), so a value
// above 9999.99 passed Zod and then made Prisma throw, surfacing as a 500. And a
// value above the question's own value is accepted, so one row can over-credit a
// student by 8x. The 500 is a bug; the over-credit is a policy question, so only
// the storage ceiling is enforced here.
// ---------------------------------------------------------------------------
const setPoints = (points: unknown) =>
  request(app)
    .post(`/grade-adjustments/exams/${EXAM}/compensate`)
    .send({ ...body, adjustment_type: 'set_points', points });

describe('set_points is bounded by what the column can store', () => {
  it.each([10000, 10000.01, 99999.99, 1e9, Number.MAX_SAFE_INTEGER])(
    'answers 400 rather than 500 for points=%s',
    async (points) => {
      const res = await setPoints(points);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
      expect(compensate).not.toHaveBeenCalled();
    },
  );

  it('accepts the largest value the column can hold', async () => {
    expect((await setPoints(9999.99)).status).toBe(200);
    expect(compensate).toHaveBeenCalledWith(expect.objectContaining({ points: 9999.99 }));
  });

  it('rejects a value with more precision than the column keeps, instead of silently rounding it', async () => {
    // Decimal(6,2) rounds rather than erroring, so 1.005 would be recorded in an audit
    // trail as 1.01 -- a compensation log that disagrees with what the actor typed.
    const res = await setPoints(1.005);
    expect(res.status).toBe(400);
    expect(compensate).not.toHaveBeenCalled();
  });

  it('still accepts 1.5, which is inside the column', async () => {
    expect((await setPoints(1.5)).status).toBe(200);
  });

  it('still rejects a negative value', async () => {
    expect((await setPoints(-1)).status).toBe(400);
  });

  it('leaves full_credit alone, since it derives its points from the exam', async () => {
    // A 500 here is impossible: the service substitutes exam.points_per_question.
    expect((await request(app).post(`/grade-adjustments/exams/${EXAM}/compensate`).send(body)).status).toBe(200);
  });
});
// The refine used to be `Number.isInteger(n * 100)`, which is binary float
// arithmetic: 0.29 * 100 is 28.999999999999996, so 131,256 of the legal
// two-decimal values in [0.01, 9999.99] -- 13.13% of them -- were refused while
// the value plainly has two decimal places. Measured against the running server
// before the fix: on otherwise byte-identical bodies, points 0.07 and 0.29 gave
// 400 Invalid payload while 0.08 and 0.25 gave 200. The check must be decimal
// arithmetic, the same arithmetic the Decimal(6,2) column stores with.
describe('POST /grade-adjustments two-decimal values survive float error', () => {
  const refusedByFloat = [0.07, 0.14, 0.28, 0.29, 0.55, 0.56, 0.57, 0.58, 1.09, 1.1, 1.11, 1.12];
  const acceptedByFloat = [0.08, 0.25, 1.5, 2, 9999.99];

  it.each(refusedByFloat)('accepts %s, which float arithmetic wrongly refused', async (points) => {
    expect(Number.isInteger(points * 100)).toBe(false);
    expect((await setPoints(points)).status).toBe(200);
    expect(compensate).toHaveBeenCalledWith(expect.objectContaining({ points }));
  });

  it.each(acceptedByFloat)('still accepts %s', async (points) => {
    expect((await setPoints(points)).status).toBe(200);
  });

  it.each([1.005, 0.294, 0.0001])('still rejects %s, which really has more than two decimals', async (points) => {
    expect((await setPoints(points)).status).toBe(400);
    expect(compensate).not.toHaveBeenCalled();
  });

  it('refuses no legal two-decimal value anywhere in the column range', () => {
    // Enumerated on the predicate, not over HTTP: a million supertest round trips
    // is a five-second test that proves the same thing far more slowly.
    const refused: number[] = [];
    for (let i = 1; i <= 999999; i++) {
      const points = i / 100;
      if (!hasAtMostTwoDecimals(points)) refused.push(points);
    }
    expect(refused).toEqual([]);
  });

  it('agrees with the old float check on the cases that check was right about', () => {
    // The fix must not turn into "accept everything": anything float accepted
    // before is still accepted, and genuinely-three-decimal values still refuse.
    for (const points of [0.08, 0.25, 1.5, 2, 9999.99, 0, 0.01]) {
      expect(hasAtMostTwoDecimals(points)).toBe(true);
    }
    for (const points of [1.005, 0.294, 0.0001, 12.3456]) {
      expect(hasAtMostTwoDecimals(points)).toBe(false);
    }
  });
});