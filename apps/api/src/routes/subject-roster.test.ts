import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  prisma: {
    subject: { findUnique: vi.fn(), count: vi.fn() },
    section: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

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
}));

import express from 'express';
import request from 'supertest';
import { subjectsRouter } from './subjects.js';

const app = express();
app.use(express.json());
app.use('/subjects', subjectsRouter);

const TA = 'ta-1';
const DOCTOR = 'doc-1';
const SUBJECT = 'sub-1';

const sectionArgs = () => prisma.section.findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> };
const studentArgs = () => prisma.user.findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown>; select: Record<string, unknown> };

beforeEach(() => {
  prisma.subject.count.mockReset().mockResolvedValue(1);
  prisma.section.findMany.mockReset().mockResolvedValue([]);
  prisma.user.findMany.mockReset().mockResolvedValue([]);
  authRef.current = { userId: TA, role: 'ta' };
});

describe('GET /subjects/:id/sections', () => {
  it('answers 404 for a subject that does not exist', async () => {
    prisma.subject.count.mockResolvedValue(0);
    prisma.section.findMany.mockResolvedValue([]);

    const res = await request(app).get(`/subjects/${SUBJECT}/sections`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Subject not found' });
    expect(prisma.section.findMany).not.toHaveBeenCalled();
  });

  it('gives a TA only the sections they teach', async () => {
    await request(app).get(`/subjects/${SUBJECT}/sections`);

    expect(sectionArgs().where).toEqual({ subject_id: SUBJECT, ta_id: TA });
  });

  it('gives a doctor every section of a subject they are assigned to', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };

    await request(app).get(`/subjects/${SUBJECT}/sections`);

    expect(sectionArgs().where).toEqual({
      subject_id: SUBJECT,
      subject: { doctor_assignments: { some: { doctor_id: DOCTOR } } },
    });
  });

  it('returns the id and name a target picker needs', async () => {
    prisma.section.findMany.mockResolvedValue([{ id: 'sec-1', subject_id: SUBJECT, name: 'Section A' }]);

    const res = await request(app).get(`/subjects/${SUBJECT}/sections`);

    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual([{ id: 'sec-1', subject_id: SUBJECT, name: 'Section A' }]);
  });
});

describe('GET /subjects/:id/students', () => {
  const studentRow = {
    id: 'stu-1',
    full_name: 'Live student',
    student_code: 'S-001',
    section_memberships: [{ section: { id: 'sec-1', name: 'Section A' } }],
  };

  it('answers 404 for a subject that does not exist', async () => {
    prisma.subject.count.mockResolvedValue(0);

    const res = await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(res.status).toBe(404);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('lists students enrolled in the subject', async () => {
    prisma.user.findMany.mockResolvedValue([studentRow]);

    const res = await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(studentArgs().where).toMatchObject({ role: 'student', enrollments: { some: { subject_id: SUBJECT } } });
    expect(res.body.students).toEqual([
      { id: 'stu-1', full_name: 'Live student', student_code: 'S-001', section_id: 'sec-1', section_name: 'Section A' },
    ]);
  });

  it("narrows a TA's roster to their own sections, matching the create-exam check", async () => {
    // exams.ts requires a TA's student_list targets to sit in one of the TA's own
    // sections. Offering anyone else would be a dead end the wizard cannot submit.
    await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(studentArgs().where).toMatchObject({
      section_memberships: { some: { section: { ta_id: TA, subject_id: SUBJECT } } },
    });
  });

  it('does not narrow a doctor roster to any section', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };

    await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(studentArgs().where).not.toHaveProperty('section_memberships');
  });

  it('reports a null section for a student with no membership in this subject', async () => {
    prisma.user.findMany.mockResolvedValue([{ ...studentRow, section_memberships: [] }]);

    const res = await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(res.body.students[0]).toEqual({
      id: 'stu-1', full_name: 'Live student', student_code: 'S-001', section_id: null, section_name: null,
    });
  });

  it('never returns a password hash or role', async () => {
    prisma.user.findMany.mockResolvedValue([studentRow]);

    await request(app).get(`/subjects/${SUBJECT}/students`);

    const select = studentArgs().select;
    expect(select).not.toHaveProperty('password_hash');
    expect(select).not.toHaveProperty('is_active');
  });
});

describe('subject roster is not reachable by a student', () => {
  it('refuses a student on the sections roster', async () => {
    authRef.current = { userId: 'stu-1', role: 'student' };

    const res = await request(app).get(`/subjects/${SUBJECT}/sections`);

    expect(res.status).toBe(403);
  });

  it('refuses a student on the students roster', async () => {
    authRef.current = { userId: 'stu-1', role: 'student' };

    const res = await request(app).get(`/subjects/${SUBJECT}/students`);

    expect(res.status).toBe(403);
  });
});
