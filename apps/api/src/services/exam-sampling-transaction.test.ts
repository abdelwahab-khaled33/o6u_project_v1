import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const getEligibleStudentIds = vi.fn<(exam: unknown, client?: unknown) => Promise<string[]>>();
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('./exam-eligibility.js', () => ({
  getEligibleStudentIds: (exam: unknown, client?: unknown) => getEligibleStudentIds(exam, client),
}));

import { generateStudentExamsForExam } from './exam-sampling.js';

function makeClient() {
  const studentExamCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const questionCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const client = {
    exam: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'exam-1',
        subject_id: 'sub-1',
        target_scope: 'sections',
        difficulty_mix: { easy: 1, medium: 0, hard: 0 },
        points_per_question: 2,
      }),
    },
    examQuestion: {
      findMany: vi.fn().mockResolvedValue([
        { question: { id: 'q1', question_type: 'mcq', difficulty: 'easy', text: 't', options: ['a'], correct_answer: 'a' } },
      ]),
    },
    studentExam: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: studentExamCreateMany,
    },
    studentExamQuestion: { createMany: questionCreateMany },
  };
  return { client: client as unknown as Prisma.TransactionClient, studentExamCreateMany, questionCreateMany };
}

describe('generateStudentExamsForExam', () => {
  it('resolves eligibility through the transaction client so it can read uncommitted target rows', async () => {
    getEligibleStudentIds.mockResolvedValueOnce(['stu-1']);
    const { client, studentExamCreateMany } = makeClient();

    await generateStudentExamsForExam(client, 'exam-1');

    expect(getEligibleStudentIds).toHaveBeenCalledTimes(1);
    expect(getEligibleStudentIds.mock.calls[0]?.[1]).toBe(client);
    expect(studentExamCreateMany).toHaveBeenCalledTimes(1);
  });

  it('still generates when the target rows are only visible inside the transaction', async () => {
    getEligibleStudentIds.mockResolvedValueOnce(['stu-1']);
    const { client, studentExamCreateMany, questionCreateMany } = makeClient();

    const result = await generateStudentExamsForExam(client, 'exam-1');

    expect(result).toEqual({ generated: 1 });
    expect(studentExamCreateMany).toHaveBeenCalledTimes(1);
    expect(questionCreateMany).toHaveBeenCalledTimes(1);
  });
});
