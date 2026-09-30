export type ExamResultRow = {
  student_id: string;
  student_name: string;
  student_code: string | null;
  section: { id: string; name: string; ta: { id: string; full_name: string } } | null;
  status: string;
  grade: number | null;
};

export type CombinedColumn = {
  id: string;
  type: 'doctor_exam' | 'ta_quiz';
  title: string;
  max_grade: number;
  owner: { id: string; full_name: string };
};

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  auto_submitted: 'Auto submitted',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

const gradeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

export function formatGradeCell(grade: number | null): string {
  if (grade === null) return '—';
  return gradeFormat.format(grade);
}

export function pointsValue(points: number | string): number {
  const parsed = Number(points);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function filterResultRows(rows: ExamResultRow[], query: string, status: string): ExamResultRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== '' && row.status !== status) return false;
    if (needle === '') return true;
    const haystacks = [
      row.student_name,
      row.student_code ?? '',
      row.section?.name ?? '',
    ].map((value) => value.toLowerCase());
    return haystacks.some((haystack) => haystack.includes(needle));
  });
}

export type ResultStats = {
  total: number;
  graded: number;
  submitted: number;
  average: number | null;
};

export function resultStats(rows: ExamResultRow[]): ResultStats {
  const grades = rows.map((row) => row.grade).filter((grade): grade is number => grade !== null);
  return {
    total: rows.length,
    graded: grades.length,
    submitted: rows.filter((row) => row.status === 'submitted').length,
    average: grades.length === 0 ? null : grades.reduce((sum, grade) => sum + grade, 0) / grades.length,
  };
}

export function exportScopeForColumn(column: CombinedColumn): string {
  return column.type === 'doctor_exam' ? `exam:${column.id}` : `quiz:${column.id}`;
}

export function buildExportPath(subjectId: string, scope: string): string {
  return `/results/export?subject_id=${encodeURIComponent(subjectId)}&scope=${encodeURIComponent(scope)}`;
}

export function exportFileName(subjectCode: string, scope: string): string {
  if (scope === 'all') return `${subjectCode}-results-all.xlsx`;
  const separator = scope.indexOf(':');
  const kind = separator === -1 ? '' : scope.slice(0, separator);
  const id = separator === -1 ? scope : scope.slice(separator + 1);
  if (kind === 'exam') return `${subjectCode}-doctor_exam-${id}.xlsx`;
  if (kind === 'quiz') return `${subjectCode}-ta_quiz-${id}.xlsx`;
  return `${subjectCode}-results-${scope}.xlsx`;
}

export function columnTypeLabel(type: CombinedColumn['type']): string {
  return type === 'doctor_exam' ? 'Exam' : 'Quiz';
}
