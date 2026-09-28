import ExcelJS from 'exceljs';
import type { Exam } from '@prisma/client';
import type { Response } from 'express';
import { computeExamMaxGrade, type CombinedResultsData, type ResultRow } from './results.js';

function addHeaderRows(ws: ExcelJS.Worksheet, rows: string[][]): void {
  for (const row of rows) {
    ws.addRow(row);
  }
}

export function buildSingleScopeWorkbook(
  exam: Exam & { subject: { code: string; name: string } },
  rows: ResultRow[],
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Results');
  const maxGrade = computeExamMaxGrade(exam);

  addHeaderRows(ws, [
    [`Subject: ${exam.subject.code} - ${exam.subject.name}`],
    [exam.title],
    [`Date/Time: ${exam.start_time.toISOString()} - ${exam.end_time.toISOString()}`],
    [`Max Grade: ${maxGrade}`],
  ]);
  ws.addRow([]);

  const headerRow = ws.addRow(['Student Name', 'Student ID', 'Section', 'Grade']);
  headerRow.font = { bold: true };

  for (const row of rows) {
    ws.addRow([row.student_name, row.student_code ?? '', row.section?.name ?? '', row.grade ?? '']);
  }

  ws.columns.forEach((col) => {
    col.width = 24;
  });

  return wb;
}

export function buildAllScopeWorkbook(data: CombinedResultsData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Results');

  addHeaderRows(ws, [
    [`Subject: ${data.subject.code} - ${data.subject.name}`],
    ['All Exams & Quizzes'],
    [`Exported: ${new Date().toISOString()}`],
    ['Max Grade: see column headers'],
  ]);
  ws.addRow([]);

  const columnHeaders = data.columns.map((c) =>
    c.type === 'ta_quiz'
      ? `${c.title} (TA: ${c.owner.full_name}) / ${c.max_grade}`
      : `${c.title} / ${c.max_grade}`,
  );
  const headerRow = ws.addRow(['Student Name', 'Student ID', 'Section', 'TA Name', ...columnHeaders]);
  headerRow.font = { bold: true };

  for (const section of data.sections) {
    for (const student of section.students) {
      ws.addRow([
        student.student_name,
        student.student_code ?? '',
        section.section.name,
        section.ta.full_name,
        ...data.columns.map((c) => student.grades[c.id] ?? ''),
      ]);
    }
  }

  ws.columns.forEach((col) => {
    col.width = 22;
  });

  return wb;
}

export async function sendWorkbook(
  res: Response,
  workbook: ExcelJS.Workbook,
  filename: string,
): Promise<void> {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}
