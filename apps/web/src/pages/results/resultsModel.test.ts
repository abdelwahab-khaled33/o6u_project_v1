import { describe, expect, it } from 'vitest';
import {
  buildExportPath,
  columnTypeLabel,
  exportFileName,
  exportScopeForColumn,
  filterResultRows,
  formatGradeCell,
  pointsValue,
  resultStats,
  statusLabel,
  type CombinedColumn,
  type ExamResultRow,
} from './resultsModel';

const rows: ExamResultRow[] = [
  {
    student_id: 's1',
    student_name: 'Amina Hassan',
    student_code: 'STU001',
    section: { id: 'sec1', name: 'Section A', ta: { id: 'ta1', full_name: 'Mona Taha' } },
    status: 'submitted',
    grade: 8,
  },
  {
    student_id: 's2',
    student_name: 'Omar Adel',
    student_code: null,
    section: null,
    status: 'in_progress',
    grade: null,
  },
  {
    student_id: 's3',
    student_name: 'Sara Nabil',
    student_code: 'STU003',
    section: { id: 'sec2', name: 'Section B', ta: { id: 'ta2', full_name: 'Karim Samy' } },
    status: 'auto_submitted',
    grade: 5.5,
  },
  {
    student_id: 's4',
    student_name: 'Tarek Zaki',
    student_code: 'STU004',
    section: { id: 'sec1', name: 'Section A', ta: { id: 'ta1', full_name: 'Mona Taha' } },
    status: 'not_started',
    grade: null,
  },
];

describe('statusLabel', () => {
  it('labels every server status in English', () => {
    expect(statusLabel('not_started')).toBe('Not started');
    expect(statusLabel('in_progress')).toBe('In progress');
    expect(statusLabel('submitted')).toBe('Submitted');
    expect(statusLabel('auto_submitted')).toBe('Auto submitted');
  });

  it('falls back to a readable label for an unknown status', () => {
    expect(statusLabel('something_new')).toBe('something new');
  });
});

describe('formatGradeCell', () => {
  it('renders a dash for an ungraded row', () => {
    expect(formatGradeCell(null)).toBe('—');
  });

  it('renders a numeric grade without converting through Number()', () => {
    expect(formatGradeCell(8)).toBe('8');
    expect(formatGradeCell(5.5)).toBe('5.5');
  });
});

describe('pointsValue', () => {
  it('reads the Decimal points_per_question through Number()', () => {
    expect(pointsValue('2')).toBe(2);
    expect(pointsValue('2.50')).toBe(2.5);
    expect(pointsValue(2)).toBe(2);
  });

  it('falls back to zero for a value that is not numeric', () => {
    expect(pointsValue('not-a-number')).toBe(0);
  });
});

describe('filterResultRows', () => {
  it('matches name, code, and section without regard to case', () => {
    expect(filterResultRows(rows, 'amina', '').map((row) => row.student_id)).toEqual(['s1']);
    expect(filterResultRows(rows, 'STU003', '').map((row) => row.student_id)).toEqual(['s3']);
    expect(filterResultRows(rows, 'section a', '').map((row) => row.student_id)).toEqual(['s1', 's4']);
  });

  it('filters by status while keeping the search', () => {
    expect(filterResultRows(rows, '', 'submitted').map((row) => row.student_id)).toEqual(['s1']);
    expect(filterResultRows(rows, 'section a', 'not_started').map((row) => row.student_id)).toEqual(['s4']);
  });

  it('returns every row for an empty query and an empty status', () => {
    expect(filterResultRows(rows, '', '')).toHaveLength(4);
  });
});

describe('resultStats', () => {
  it('counts graded rows and averages only those grades', () => {
    const stats = resultStats(rows);
    expect(stats.total).toBe(4);
    expect(stats.graded).toBe(2);
    expect(stats.submitted).toBe(1);
    expect(stats.average).toBeCloseTo(6.75);
  });

  it('reports a null average when no row is graded', () => {
    const stats = resultStats(rows.filter((row) => row.grade === null));
    expect(stats.graded).toBe(0);
    expect(stats.average).toBeNull();
  });
});

describe('exportScopeForColumn', () => {
  it('emits exam:{id} for a doctor exam and quiz:{id} for a TA quiz', () => {
    const exam: CombinedColumn = {
      id: 'exam1',
      type: 'doctor_exam',
      title: 'Final',
      max_grade: 12,
      owner: { id: 'd1', full_name: 'Live Doc' },
    };
    const quiz: CombinedColumn = {
      id: 'quiz1',
      type: 'ta_quiz',
      title: 'Quiz 1',
      max_grade: 6,
      owner: { id: 't1', full_name: 'Live TA' },
    };
    expect(exportScopeForColumn(exam)).toBe('exam:exam1');
    expect(exportScopeForColumn(quiz)).toBe('quiz:quiz1');
  });
});

describe('buildExportPath', () => {
  it('encodes the subject id and the scope for api.download', () => {
    expect(buildExportPath('subject 1', 'all')).toBe('/results/export?subject_id=subject%201&scope=all');
    expect(buildExportPath('subject1', 'exam:exam1')).toBe(
      '/results/export?subject_id=subject1&scope=exam%3Aexam1',
    );
  });
});

describe('exportFileName', () => {
  it('matches the names the server streams for each scope', () => {
    expect(exportFileName('CS101', 'all')).toBe('CS101-results-all.xlsx');
    expect(exportFileName('CS101', 'exam:exam1')).toBe('CS101-doctor_exam-exam1.xlsx');
    expect(exportFileName('CS101', 'quiz:quiz1')).toBe('CS101-ta_quiz-quiz1.xlsx');
  });

  it('names an unrecognized scope neutrally instead of mislabeling it', () => {
    expect(exportFileName('CS101', 'other:xyz')).toBe('CS101-results-other:xyz.xlsx');
  });
});

describe('columnTypeLabel', () => {
  it('says Exam for a doctor exam and Quiz for a TA quiz', () => {
    expect(columnTypeLabel('doctor_exam')).toBe('Exam');
    expect(columnTypeLabel('ta_quiz')).toBe('Quiz');
  });
});
