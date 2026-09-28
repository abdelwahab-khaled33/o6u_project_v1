import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Exam } from '@prisma/client';
import type { AuthPayload } from '../lib/jwt.js';

const isDoctorOfSubject = vi.fn<(userId: string, subjectId: string) => Promise<boolean>>();
const prismaMock = {
  doctorAssignment: { findFirst: vi.fn() },
};

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock,
}));
vi.mock('./subject-access.js', () => ({
  isDoctorOfSubject,
}));
vi.mock('./exam-eligibility.js', () => ({
  getEligibleStudentIds: vi.fn(),
}));

const { checkExamResultAccess } = await import('./results.js');

const MINUTE = 60 * 1000;

function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    subject_id: 'subject-1',
    type: 'doctor_exam',
    owner_id: 'owner-1',
    end_time: new Date(Date.now() + 60 * MINUTE),
    ...overrides,
  } as Exam;
}

function auth(overrides: Partial<AuthPayload> = {}): AuthPayload {
  return { userId: 'user-1', role: 'doctor', ...overrides };
}

describe('checkExamResultAccess ordering', () => {
  beforeEach(() => {
    isDoctorOfSubject.mockReset();
    isDoctorOfSubject.mockResolvedValue(false);
  });

  it('refuses a TA on someone else quiz with 403 even while the quiz is still open', async () => {
    // The defect this pins: hasEnded used to be evaluated before the ownership checks, so a
    // TA who may never see these results got 409 (which also revealed that the exam exists
    // and is still running) until the clock passed end_time, and only then 403. Authorisation
    // has to be decided before anything that discloses existence or timing.
    const access = await checkExamResultAccess(
      auth({ role: 'ta', userId: 'ta-1' }),
      exam({ type: 'ta_quiz', owner_id: 'ta-other' }),
    );
    expect(access).toEqual({
      ok: false,
      status: 403,
      error: 'You can only view results for your own quizzes',
    });
    expect(isDoctorOfSubject).not.toHaveBeenCalled();
  });

  it('refuses a doctor who does not own a doctor exam with 403 while it is still running', async () => {
    const access = await checkExamResultAccess(
      auth({ role: 'doctor', userId: 'doc-other' }),
      exam({ type: 'doctor_exam', owner_id: 'doc-1' }),
    );
    expect(access).toEqual({ ok: false, status: 403, error: 'You do not own this exam' });
  });

  it('refuses a doctor who is not the subject doctor for a TA quiz with 403 while it runs', async () => {
    isDoctorOfSubject.mockResolvedValue(false);
    const access = await checkExamResultAccess(
      auth({ role: 'doctor', userId: 'doc-1' }),
      exam({ type: 'ta_quiz', owner_id: 'ta-1' }),
    );
    expect(access).toEqual({
      ok: false,
      status: 403,
      error: 'You are not the doctor of this subject',
    });
  });

  it('still answers 409 to an authorised viewer before the exam ends', async () => {
    // The time gate is not removed, only moved behind the authorisation checks.
    const access = await checkExamResultAccess(
      auth({ role: 'doctor', userId: 'doc-1' }),
      exam({ type: 'doctor_exam', owner_id: 'doc-1' }),
    );
    expect(access).toEqual({
      ok: false,
      status: 409,
      error: 'Results are available after the exam/quiz ends',
    });
  });

  it('lets the owning doctor read results once the exam has ended', async () => {
    const access = await checkExamResultAccess(
      auth({ role: 'doctor', userId: 'doc-1' }),
      exam({
        type: 'doctor_exam',
        owner_id: 'doc-1',
        end_time: new Date(Date.now() - MINUTE),
      }),
    );
    expect(access).toEqual({ ok: true });
  });

  it('lets the owning TA read their own ended quiz', async () => {
    const access = await checkExamResultAccess(
      auth({ role: 'ta', userId: 'ta-1' }),
      exam({
        type: 'ta_quiz',
        owner_id: 'ta-1',
        end_time: new Date(Date.now() - MINUTE),
      }),
    );
    expect(access).toEqual({ ok: true });
  });

  it('lets a subject doctor read an ended TA quiz', async () => {
    isDoctorOfSubject.mockResolvedValue(true);
    const access = await checkExamResultAccess(
      auth({ role: 'doctor', userId: 'doc-1' }),
      exam({ type: 'ta_quiz', owner_id: 'ta-1', end_time: new Date(Date.now() - MINUTE) }),
    );
    expect(access).toEqual({ ok: true });
  });

  it('refuses a student regardless of timing', async () => {
    const access = await checkExamResultAccess(
      auth({ role: 'student', userId: 'stu-1' }),
      exam({ end_time: new Date(Date.now() - MINUTE) }),
    );
    expect(access).toEqual({
      ok: false,
      status: 403,
      error: 'Students cannot view exam results',
    });
  });

  it('keeps the admin bypass, which is the documented see-everything role', async () => {
    const access = await checkExamResultAccess(
      auth({ role: 'admin', userId: 'admin-1' }),
      exam(),
    );
    expect(access).toEqual({ ok: true });
  });
});
