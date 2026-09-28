import ExcelJS from 'exceljs';
import type { Role } from '@exam/shared';
import { prisma } from '../lib/prisma.js';

const headers = [
  'Question Text',
  'Type',
  'Options',
  'Correct Answer',
  'Grade',
  'Difficulty',
  'Image Filename',
  'Author',
];

export async function buildQuestionBankWorkbook(
  subjectId: string,
  userId: string,
  role: Role,
): Promise<ExcelJS.Workbook> {
  const ownerFilter =
    role === 'doctor'
      ? { owner_type: 'doctor' as const, doctor_id: userId }
      : role === 'ta'
        ? { owner_type: 'ta_shared' as const }
        : {};
  const questions = await prisma.question.findMany({
    where: { subject_id: subjectId, is_archived: false, ...ownerFilter },
    select: {
      question_type: true,
      text: true,
      options: true,
      correct_answer: true,
      grade: true,
      difficulty: true,
      image_url: true,
      owner: { select: { full_name: true } },
      added_by_ta: { select: { full_name: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Questions');
  worksheet.addRow(headers);

  for (const question of questions) {
    worksheet.addRow([
      question.text,
      question.question_type,
      question.question_type === 'mcq' ? (question.options as string[]).join('|') : '',
      question.correct_answer,
      Number(question.grade),
      question.difficulty,
      question.image_url ?? '',
      question.owner?.full_name ?? question.added_by_ta?.full_name ?? '',
    ]);
  }

  worksheet.columns.forEach((column) => {
    column.width = 24;
  });

  return workbook;
}
