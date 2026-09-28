import { readFirstSheet } from './excel.js';
import { prisma } from '../lib/prisma.js';
import type { QuestionType, Difficulty } from '@exam/shared';

export type ParsedQuestionRow = {
  text: string;
  questionType: QuestionType;
  options: string[];
  correctAnswer: string;
  grade: number;
  difficulty: Difficulty;
  imageUrl: string | null;
  rawRow: number;
};

export type QuestionImportReport = {
  total: number;
  valid: number;
  errorCount: number;
  errors: { row: number; reason: string }[];
};

function parseOptions(raw: string): string[] {
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRows(
  raw: { cells: Record<string, string>; rowNumber: number }[],
): { rows: ParsedQuestionRow[]; errors: { row: number; reason: string }[] } {
  const rows: ParsedQuestionRow[] = [];
  const errors: { row: number; reason: string }[] = [];

  for (const rawRow of raw) {
    const c = rawRow.cells;
    const text = c['Question Text'] ?? c.text ?? '';
    const typeRaw = (c.Type ?? c.question_type ?? '').toLowerCase();
    const optionsRaw = c.Options ?? c.options ?? '';
    const correctAnswer = (c['Correct Answer'] ?? c.correct_answer ?? '').trim();
    const gradeRaw = Number(c.Grade ?? c.grade);
    const difficultyRaw = (c.Difficulty ?? c.difficulty ?? '').toLowerCase();
    const imageUrl = c['Image Filename'] ?? c.image_filename ?? null;

    let reason: string | null = null;
    if (!text) reason = 'Missing question text';
    else if (!['mcq', 'true_false'].includes(typeRaw)) reason = `Invalid type "${typeRaw}"`;
    else if (!Number.isFinite(gradeRaw) || gradeRaw <= 0) reason = 'Invalid grade (must be > 0)';
    else if (!['easy', 'medium', 'hard'].includes(difficultyRaw)) reason = 'Invalid difficulty';
    else if (typeRaw === 'mcq') {
      const options = parseOptions(optionsRaw);
      if (options.length < 2) reason = 'MCQ requires at least 2 options (pipe-separated)';
      else if (!options.includes(correctAnswer)) reason = 'Correct answer must be one of the options';
    } else if (typeRaw === 'true_false') {
      if (!['true', 'false'].includes(correctAnswer.toLowerCase())) reason = 'Correct answer must be true/false';
    }

    if (reason) {
      errors.push({ row: rawRow.rowNumber, reason });
      continue;
    }

    rows.push({
      text,
      questionType: typeRaw as QuestionType,
      options: typeRaw === 'mcq' ? parseOptions(optionsRaw) : [],
      correctAnswer,
      grade: gradeRaw,
      difficulty: difficultyRaw as Difficulty,
      imageUrl: imageUrl ? String(imageUrl) : null,
      rawRow: rawRow.rowNumber,
    });
  }

  return { rows, errors };
}

export async function dryRunQuestionImport(buffer: Buffer): Promise<QuestionImportReport> {
  const { rows } = await readFirstSheet(buffer);
  const parsed = parseRows(rows);
  return {
    total: rows.length,
    valid: parsed.rows.length,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
  };
}

export async function commitQuestionImport(params: {
  buffer: Buffer;
  subjectId: string;
  doctorId: string | null;
  addedByTaId: string | null;
  ownerType: 'doctor' | 'ta_shared';
  uploadedBy: string;
  filename: string;
}): Promise<QuestionImportReport> {
  const { rows } = await readFirstSheet(params.buffer);
  const parsed = parseRows(rows);

  for (const row of parsed.rows) {
    await prisma.question.create({
      data: {
        subject_id: params.subjectId,
        owner_type: params.ownerType,
        doctor_id: params.doctorId,
        added_by_ta_id: params.addedByTaId,
        question_type: row.questionType,
        text: row.text,
        options: row.options,
        correct_answer: row.correctAnswer,
        grade: row.grade,
        difficulty: row.difficulty,
        image_url: row.imageUrl,
      },
    });
  }

  if (parsed.rows.length > 0) {
    await prisma.excelImportLog.create({
      data: {
        import_type: 'questions',
        uploaded_by: params.uploadedBy,
        filename: params.filename,
        total_rows: rows.length,
        imported_count: parsed.rows.length,
        error_count: parsed.errors.length,
        error_report:
          parsed.errors.length > 0
            ? { errors: parsed.errors.map((e) => ({ row: e.row, reason: e.reason })) }
            : undefined,
      },
    });
  }

  return {
    total: rows.length,
    valid: parsed.rows.length,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
  };
}