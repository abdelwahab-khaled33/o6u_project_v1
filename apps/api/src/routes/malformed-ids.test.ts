import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every path and query id in the API must be checked before it reaches Prisma.
 *
 * Prisma throws P2023 on a non-uuid, and the app's error handler turns an unrecognised
 * 5xx into a generic 500. So a typo'd URL -- "the exam id I copied had a g in it" --
 * answered 500 on 17 of 22 id-carrying routes, including all five student exam-taking
 * routes. A well-formed id matching no row answered 404 on the same routes, so the two
 * cases were distinguishable from the outside.
 *
 * Every case below therefore asserts that NO prisma method was called. Asserting the
 * status alone would prove nothing here: a mocked client resolves null, so an unguarded
 * route still answers 404 and the test goes green over the real defect. That is exactly
 * the false all-clear the earlier uuid-param session hit.
 */

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' } },
  prisma: {
    $transaction: vi.fn(),
    exam: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
    studentExam: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    studentExamQuestion: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    subject: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), count: vi.fn() },
    section: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), count: vi.fn() },
    question: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    gradeAdjustment: { findMany: vi.fn() },
    enrollment: { findMany: vi.fn(), upsert: vi.fn() },
    sectionMembership: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    doctorAssignment: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    examTargetSection: { findMany: vi.fn() },
    examTargetStudent: { findMany: vi.fn() },
    userPermissionOverride: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    permission: { findMany: vi.fn() },
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

// requireSeb is left real on purpose: it looks the exam up itself, so a malformed id used
// to blow up inside the middleware rather than in the route. A uuid guard placed after it
// would leave every one of the five student routes still answering 500.
import express from 'express';
import request from 'supertest';
import { adminRouter } from './admin.js';
import { adminExamsRouter } from './admin-exams.js';
import { examsRouter } from './exams.js';
import { questionBankRouter } from './questions.js';
import { studentExamsRouter } from './student-exams.js';
import { subjectsRouter } from './subjects.js';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use('/admin-exams', adminExamsRouter);
app.use('/exams', examsRouter);
app.use('/question-bank', questionBankRouter);
app.use('/student/exams', studentExamsRouter);
app.use('/subjects', subjectsRouter);

const BAD = 'not-a-uuid';
const GOOD = '00000000-0000-4000-8000-000000000000';

/** Every mock on the prisma object, so "the database was never touched" is one check. */
function prismaMocks(): ReturnType<typeof vi.fn>[] {
  const out: ReturnType<typeof vi.fn>[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'function') out.push(value as ReturnType<typeof vi.fn>);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(prisma);
  return out;
}

type Case = {
  label: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  body?: unknown;
  role?: string;
  message: string;
  /** Rows the first-level lookups must return, so a guard on a second param is reached. */
  resolve?: () => void;
  /** Prisma methods that must not be called even though an earlier lookup may be. */
  never?: string[];
};

const OWNED_EXAM = { id: GOOD, type: 'doctor_exam', owner_id: '11111111-1111-4111-8111-111111111111', subject_id: GOOD, status: 'approved' };

const CASES: Case[] = [
  // --- exams.ts -------------------------------------------------------------
  { label: 'GET /exams/:id', method: 'get', path: `/exams/${BAD}`, message: 'Exam not found' },
  { label: 'GET /exams/:id/access-code', method: 'get', path: `/exams/${BAD}/access-code`, message: 'Exam not found' },
  { label: 'GET /exams/:examId/live', method: 'get', path: `/exams/${BAD}/live`, message: 'Exam not found' },
  { label: 'PATCH /exams/:id', method: 'patch', path: `/exams/${BAD}`, body: { title: 'x' }, message: 'Exam not found' },
  { label: 'DELETE /exams/:id', method: 'delete', path: `/exams/${BAD}`, message: 'Exam not found' },
  {
    label: 'POST /exams/:examId/attempts/:studentExamId/release, bad examId',
    method: 'post',
    path: `/exams/${BAD}/attempts/${GOOD}/release`,
    message: 'Exam not found',
  },
  {
    label: 'POST /exams/:examId/attempts/:studentExamId/release, bad studentExamId',
    method: 'post',
    path: `/exams/${GOOD}/attempts/${BAD}/release`,
    message: 'Exam attempt not found',
    // The exam is looked up first on purpose: authorization has to precede the attempt
    // lookup, so a well-formed exam id is expected to reach the database here.
    resolve: () => prisma.exam.findUnique.mockResolvedValue(OWNED_EXAM),
    never: ['studentExam.findUnique', 'studentExam.update'],
  },

  // --- admin-exams.ts -------------------------------------------------------
  { label: 'POST /admin/exams/:id/approve', method: 'post', path: `/admin-exams/exams/${BAD}/approve`, message: 'Exam not found' },
  { label: 'POST /admin/exams/:id/reject', method: 'post', path: `/admin-exams/exams/${BAD}/reject`, body: { reason: 'because' }, message: 'Exam not found' },
  { label: 'POST /admin/exams/:id/access-code/regenerate', method: 'post', path: `/admin-exams/exams/${BAD}/access-code/regenerate`, message: 'Exam not found' },

  // --- admin.ts -------------------------------------------------------------
  { label: 'POST /admin/users/:id/reset-password', method: 'post', path: `/admin/users/${BAD}/reset-password`, body: { new_password: 'Passw0rd!23' }, message: 'User not found' },
  { label: 'PATCH /admin/users/:id', method: 'patch', path: `/admin/users/${BAD}`, body: { full_name: 'x' }, message: 'User not found' },
  { label: 'PATCH /admin/subjects/:id', method: 'patch', path: `/admin/subjects/${BAD}`, body: { name: 'x' }, message: 'Subject not found' },
  { label: 'DELETE /admin/subjects/:id', method: 'delete', path: `/admin/subjects/${BAD}`, message: 'Subject not found' },
  { label: 'PATCH /admin/sections/:id', method: 'patch', path: `/admin/sections/${BAD}`, body: { name: 'x' }, message: 'Section not found' },
  { label: 'DELETE /admin/sections/:id', method: 'delete', path: `/admin/sections/${BAD}`, message: 'Section not found' },
  { label: 'GET /admin/permissions/users/:id', method: 'get', path: `/admin/permissions/users/${BAD}`, message: 'User not found' },
  { label: 'PATCH /admin/permissions/users/:id', method: 'patch', path: `/admin/permissions/users/${BAD}`, body: { allowed: true }, message: 'User not found' },
  {
    label: 'GET /admin/doctor-assignments/:doctorId',
    method: 'get',
    path: `/admin/doctor-assignments/${BAD}`,
    // Reads like the sibling write route on purpose, which is what makes the pair
    // indistinguishable to a caller guessing ids.
    message: 'Doctor not found',
  },

  // --- questions.ts ---------------------------------------------------------
  { label: 'PATCH /question-bank/:id', method: 'patch', path: `/question-bank/${BAD}`, body: { text: 'x' }, message: 'Question not found' },
  { label: 'DELETE /question-bank/:id', method: 'delete', path: `/question-bank/${BAD}`, message: 'Question not found' },
  {
    label: 'GET /question-bank?subject_id=',
    method: 'get',
    path: `/question-bank?subject_id=${BAD}`,
    message: 'Subject not found',
    role: 'doctor',
  },
  {
    label: 'GET /question-bank/export?subject_id=',
    method: 'get',
    path: `/question-bank/export?subject_id=${BAD}`,
    message: 'Subject not found',
    role: 'doctor',
  },

  // --- subjects.ts -- these reached Prisma through a count() ---------------
  { label: 'GET /subjects/:id/sections', method: 'get', path: `/subjects/${BAD}/sections`, message: 'Subject not found' },
  { label: 'GET /subjects/:id/students', method: 'get', path: `/subjects/${BAD}/students`, message: 'Subject not found' },

  // --- student-exams.ts -- the student-facing five, and the worst of the set -
  { label: 'POST /student/exams/:examId/start', method: 'post', path: `/student/exams/${BAD}/start`, body: {}, role: 'student', message: 'Exam not found' },
  { label: 'PATCH /student/exams/:examId/answer', method: 'patch', path: `/student/exams/${BAD}/answer`, body: { selected_answer: 'x' }, role: 'student', message: 'Exam not found' },
  { label: 'PATCH /student/exams/:examId/flag', method: 'patch', path: `/student/exams/${BAD}/flag`, body: { is_flagged: true }, role: 'student', message: 'Exam not found' },
  { label: 'POST /student/exams/:examId/heartbeat', method: 'post', path: `/student/exams/${BAD}/heartbeat`, body: {}, role: 'student', message: 'Exam not found' },
  { label: 'POST /student/exams/:examId/submit', method: 'post', path: `/student/exams/${BAD}/submit`, body: {}, role: 'student', message: 'Exam not found' },
];

beforeEach(() => {
  vi.clearAllMocks();
  authRef.current = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' };
  prisma.exam.findUnique.mockResolvedValue(null);
});

describe('a malformed path id is the route own 404 and never reaches Prisma', () => {
  it.each(CASES)('$label', async ({ method, path, body, role, message, resolve, never }) => {
    if (role) authRef.current = { userId: '11111111-1111-4111-8111-111111111111', role };
    resolve?.();

    const send = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!;
    const res = await send(path).send(body as never);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: message });

    if (never) {
      const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
      for (const key of never) {
        const [model, fn] = key.split('.') as [string, string];
        expect([key, db[model]![fn]!.mock.calls.length]).toEqual([key, 0]);
      }
    } else {
      const touched = prismaMocks().filter((m) => m.mock.calls.length > 0).length;
      expect([path, touched]).toEqual([path, 0]);
    }
  });
});

describe('body ids are validated too, not just path ids', () => {
  it('PUT /admin/enrollments rejects a malformed student_id', async () => {
    const res = await request(app)
      .put('/admin/enrollments')
      .send({ student_id: BAD, subject_id: GOOD, section_id: GOOD });

    // 400, because a body field that is present but the wrong shape is a bad request.
    // What matters is that it never becomes a 500 out of Prisma.
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PUT /admin/enrollments rejects a malformed section_id and subject_id', async () => {
    for (const key of ['section_id', 'subject_id']) {
      const res = await request(app)
        .put('/admin/enrollments')
        .send({ student_id: GOOD, subject_id: GOOD, section_id: GOOD, [key]: BAD });
      expect([key, res.status]).toEqual([key, 400]);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PUT /admin/doctor-assignments rejects a malformed doctor_id', async () => {
    const res = await request(app)
      .put('/admin/doctor-assignments')
      .send({ doctor_id: BAD, subject_ids: [GOOD] });

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PUT /admin/doctor-assignments rejects a malformed entry in subject_ids', async () => {
    const res = await request(app)
      .put('/admin/doctor-assignments')
      .send({ doctor_id: GOOD, subject_ids: [GOOD, BAD] });

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still accepts three well-formed ids, so the guard is not over-strict', async () => {
    prisma.$transaction.mockResolvedValue({ enrollment: {}, membership: {}, removed_memberships: 0 });
    const res = await request(app)
      .put('/admin/enrollments')
      .send({ student_id: GOOD, subject_id: GOOD, section_id: GOOD });

    expect(res.status).toBe(200);
  });
});

describe('a malformed query id is refused too', () => {
  it('GET /exams with a malformed subject_id is an invalid filter, not a 500', async () => {
    const res = await request(app).get(`/exams?subject_id=${BAD}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid exam filter' });
    expect(prisma.exam.findMany).not.toHaveBeenCalled();
  });

  it('still accepts a well-formed subject_id on GET /exams', async () => {
    prisma.exam.findMany.mockResolvedValue([]);
    const res = await request(app).get(`/exams?subject_id=${GOOD}`);
    expect(res.status).toBe(200);
  });
});
