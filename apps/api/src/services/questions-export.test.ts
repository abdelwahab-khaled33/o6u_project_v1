import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    question: { findMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';
import { dryRunQuestionImport } from './questions-import.js';
import { buildQuestionBankWorkbook } from './questions-export.js';
import { readFirstSheet } from './excel.js';

describe('question bank export', () => {
  it('exports importer-compatible rows for MCQ and true/false questions', async () => {
    vi.mocked(prisma.question).findMany.mockResolvedValue([
      {
        id: 'mcq-1',
        question_type: 'mcq',
        text: 'Which number is even?',
        options: ['One', 'Two', 'Three', 'Five'],
        correct_answer: 'Two',
        grade: { toString: () => '2' } as never,
        difficulty: 'medium',
        image_url: '/uploads/even.png',
        added_by_ta: { full_name: 'Taylor TA' },
      },
      {
        id: 'tf-1',
        question_type: 'true_false',
        text: 'Two is an even number.',
        options: [],
        correct_answer: 'true',
        grade: { toString: () => '1' } as never,
        difficulty: 'easy',
        image_url: null,
        added_by_ta: { full_name: 'Taylor TA' },
      },
    ] as never);

    const workbook = await buildQuestionBankWorkbook('subject-1', 'ta-1', 'ta');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { headers, rows } = await readFirstSheet(buffer);

    expect(headers.slice(0, 7)).toEqual([
      'Question Text',
      'Type',
      'Options',
      'Correct Answer',
      'Grade',
      'Difficulty',
      'Image Filename',
    ]);
    expect(rows.map(({ cells }) => cells)).toEqual([
      {
        'Question Text': 'Which number is even?',
        Type: 'mcq',
        Options: 'One|Two|Three|Five',
        'Correct Answer': 'Two',
        Grade: '2',
        Difficulty: 'medium',
        'Image Filename': '/uploads/even.png',
        Author: 'Taylor TA',
      },
      {
        'Question Text': 'Two is an even number.',
        Type: 'true_false',
        Options: '',
        'Correct Answer': 'true',
        Grade: '1',
        Difficulty: 'easy',
        'Image Filename': '',
        Author: 'Taylor TA',
      },
    ]);
    await expect(dryRunQuestionImport(buffer)).resolves.toMatchObject({
      total: 2,
      valid: 2,
      errorCount: 0,
      errors: [],
    });
  });
});
