import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  prisma: {
    question: { findMany: vi.fn() },
    section: { count: vi.fn() },
    doctorAssignment: { count: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = authRef.current;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { questionBankRouter } from './questions.js';

const app = express();
app.use(express.json());
app.use('/question-bank', questionBankRouter);

const TA_ME = 'ta-me';
const TA_OTHER = 'ta-other';
const DOCTOR = 'doc-1';

type ListArgs = { where: Record<string, unknown>; select: Record<string, unknown> };

const lastCall = (): ListArgs => prisma.question.findMany.mock.calls.at(-1)![0] as ListArgs;

const sharedRow = (over: Record<string, unknown> = {}) => ({
  id: 'q-ta-1',
  question_type: 'mcq',
  text: 'Which of these is a relation?',
  options: ['Alpha', 'Beta'],
  correct_answer: 'Alpha',
  grade: 2,
  difficulty: 'easy',
  image_url: null,
  owner_type: 'ta_shared',
  created_at: new Date('2026-09-28T09:00:00.000Z'),
  doctor_id: null,
  added_by_ta_id: TA_ME,
  owner: null,
  added_by_ta: { id: TA_ME, full_name: 'Nour El-Sayed' },
  ...over,
});

const doctorRow = (over: Record<string, unknown> = {}) => ({
  id: 'q-doc-1',
  question_type: 'mcq',
  text: 'Which of these is a measure of central tendency?',
  options: ['Mean', 'Range'],
  correct_answer: 'Mean',
  grade: 2,
  difficulty: 'medium',
  image_url: null,
  owner_type: 'doctor',
  created_at: new Date('2026-09-28T08:00:00.000Z'),
  doctor_id: DOCTOR,
  added_by_ta_id: null,
  owner: { id: DOCTOR, full_name: 'Dr. Hana Mahmoud' },
  added_by_ta: null,
  ...over,
});

beforeEach(() => {
  prisma.question.findMany.mockReset();
  prisma.section.count.mockReset().mockResolvedValue(1);
  prisma.doctorAssignment.count.mockReset().mockResolvedValue(1);
  authRef.current = { userId: TA_ME, role: 'ta' };
});

describe('GET /question-bank — author attribution', () => {
  it('asks the database for both author relations, not just the question scalars', async () => {
    // The defect this pins: the select named nine scalar fields and neither relation,
    // so no client could ever name an author and the export was the odd one out.
    prisma.question.findMany.mockResolvedValue([]);

    await request(app).get('/question-bank?subject_id=sub-1');

    const { select } = lastCall();
    expect(select).toHaveProperty('owner');
    expect(select).toHaveProperty('added_by_ta');
    expect((select.owner as { select: Record<string, unknown> }).select).toMatchObject({
      id: true,
      full_name: true,
    });
    expect((select.added_by_ta as { select: Record<string, unknown> }).select).toMatchObject({
      id: true,
      full_name: true,
    });
  });

  it('names the TA who added a shared question', async () => {
    prisma.question.findMany.mockResolvedValue([sharedRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].author).toEqual({ id: TA_ME, full_name: 'Nour El-Sayed' });
  });

  it("names a TA's colleague on someone else's shared question", async () => {
    prisma.question.findMany.mockResolvedValue([
      sharedRow({ id: 'q-ta-2', added_by_ta_id: TA_OTHER, added_by_ta: { id: TA_OTHER, full_name: 'Omar Halim' } }),
    ]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].author).toEqual({ id: TA_OTHER, full_name: 'Omar Halim' });
  });

  it('names the owning doctor on a doctor-authored question', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([doctorRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].author).toEqual({ id: DOCTOR, full_name: 'Dr. Hana Mahmoud' });
  });

  it('reports author as null rather than guessing when no relation resolves', async () => {
    prisma.question.findMany.mockResolvedValue([sharedRow({ added_by_ta: null })]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].author).toBeNull();
  });
});

describe('GET /question-bank — can_edit is decided by the server', () => {
  it('lets a TA edit their own shared question', async () => {
    prisma.question.findMany.mockResolvedValue([sharedRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].can_edit).toBe(true);
  });

  it("refuses can_edit on a colleague's shared question", async () => {
    // Spec: a TA may only edit/delete their own questions. The list must not leave the
    // client to re-derive that rule from author ids.
    prisma.question.findMany.mockResolvedValue([
      sharedRow({ id: 'q-ta-2', added_by_ta_id: TA_OTHER, added_by_ta: { id: TA_OTHER, full_name: 'Omar Halim' } }),
    ]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].can_edit).toBe(false);
  });

  it('lets a doctor edit their own question', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([doctorRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].can_edit).toBe(true);
  });

  it('refuses can_edit when a doctor row belongs to a different doctor', async () => {
    authRef.current = { userId: 'doc-2', role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([doctorRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].can_edit).toBe(false);
  });

});

describe('GET /question-bank — one authoritative signal, not two to compare', () => {
  it('does not hand the client a raw ownership column to diff against', async () => {
    // The doctor_id / added_by_ta_id columns are selected because canEditQuestion
    // needs them, but shipping them would invite a client to re-derive ownership.
    prisma.question.findMany.mockResolvedValue([sharedRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    const row = res.body.questions[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('doctor_id');
    expect(row).not.toHaveProperty('added_by_ta_id');
    expect(row).not.toHaveProperty('owner');
    expect(row).not.toHaveProperty('added_by_ta');
    expect(Object.keys(row).sort()).toContain('author');
    expect(Object.keys(row).sort()).toContain('can_edit');
  });
});

describe('GET /question-bank — is_mine, so the own_questions pool needs no client-side ownership', () => {
  it('marks the shared question a TA added themselves', async () => {
    prisma.question.findMany.mockResolvedValue([sharedRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].is_mine).toBe(true);
  });

  it("refuses is_mine on a colleague's shared question", async () => {
    prisma.question.findMany.mockResolvedValue([
      sharedRow({ id: 'q-ta-2', added_by_ta_id: TA_OTHER, added_by_ta: { id: TA_OTHER, full_name: 'Omar Halim' } }),
    ]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].is_mine).toBe(false);
  });

  it('refuses is_mine to a TA on a row whose author column does not resolve', async () => {
    // A null added_by_ta_id must not read as "mine" through a loose comparison.
    prisma.question.findMany.mockResolvedValue([sharedRow({ added_by_ta_id: null, added_by_ta: null })]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].is_mine).toBe(false);
  });

  it('marks a doctor their own question', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([doctorRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].is_mine).toBe(true);
  });

  it('still refuses can_edit when a doctor row belongs to a different doctor', async () => {
    authRef.current = { userId: 'doc-2', role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([doctorRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.body.questions[0].is_mine).toBe(false);
  });
});

describe('GET /question-bank — a TA cannot read a subject they do not teach', () => {
  it('refuses a subject the TA has no section in, and queries nothing', async () => {
    prisma.section.count.mockResolvedValue(0);

    const res = await request(app).get('/question-bank?subject_id=someone-elses-subject');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You do not manage this subject' });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });

  it('refuses a subject the doctor is not assigned to', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.doctorAssignment.count.mockResolvedValue(0);

    const res = await request(app).get('/question-bank?subject_id=someone-elses-subject');

    expect(res.status).toBe(403);
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });

  it('refuses an admin outright, matching the spec 9 matrix', async () => {
    // The router guard already 403s an admin before this point. The gate refusing it as
    // well is the fail-closed half: relaxing that guard must not hand admin a bank.
    authRef.current = { userId: 'admin-1', role: 'admin' };
    prisma.question.findMany.mockResolvedValue([sharedRow()]);

    const res = await request(app).get('/question-bank?subject_id=sub-1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You do not manage this subject' });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });

  it('still restricts an unqualified request to the subjects the caller manages', async () => {
    // No subject_id means there is nothing to run canManageBank against, so the
    // relation filter is the only thing standing between a TA and every shared bank.
    prisma.question.findMany.mockResolvedValue([]);

    await request(app).get('/question-bank');

    expect(lastCall().where).toMatchObject({
      owner_type: 'ta_shared',
      subject: { sections: { some: { ta_id: TA_ME } } },
    });
    expect(lastCall().where).not.toHaveProperty('subject_id');
  });

  it('restricts an unqualified doctor request to their assigned subjects', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([]);

    await request(app).get('/question-bank');

    expect(lastCall().where).toMatchObject({
      owner_type: 'doctor',
      doctor_id: DOCTOR,
      subject: { doctor_assignments: { some: { doctor_id: DOCTOR } } },
    });
  });
});

describe('GET /question-bank — existing scoping is unchanged', () => {
  it("scopes a TA to the whole shared bank, with no author filter", async () => {
    prisma.question.findMany.mockResolvedValue([]);

    await request(app).get('/question-bank?subject_id=sub-1');

    expect(lastCall().where).toEqual({
      subject_id: 'sub-1',
      owner_type: 'ta_shared',
      is_archived: false,
      subject: { sections: { some: { ta_id: TA_ME } } },
    });
  });

  it('scopes a doctor to their own private questions', async () => {
    authRef.current = { userId: DOCTOR, role: 'doctor' };
    prisma.question.findMany.mockResolvedValue([]);

    await request(app).get('/question-bank?subject_id=sub-1');

    expect(lastCall().where).toEqual({
      subject_id: 'sub-1',
      owner_type: 'doctor',
      doctor_id: DOCTOR,
      is_archived: false,
      subject: { doctor_assignments: { some: { doctor_id: DOCTOR } } },
    });
  });
});
