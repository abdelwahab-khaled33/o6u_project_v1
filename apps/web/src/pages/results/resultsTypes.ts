import type { CombinedColumn, ExamResultRow } from './resultsModel';

export type ExamResultExam = {
  id: string;
  type: 'doctor_exam' | 'ta_quiz';
  title: string;
  subject: { id: string; code: string; name: string };
  start_time: string;
  end_time: string;
  points_per_question: number | string;
  max_grade: number;
  owner: { id: string; full_name: string };
};

export type ExamResultsResponse = {
  exam: ExamResultExam;
  results: ExamResultRow[];
};

export type CombinedStudent = {
  student_id: string;
  student_name: string;
  student_code: string | null;
  grades: Record<string, number | null>;
};

export type CombinedSectionView = {
  section: { id: string; name: string };
  ta: { id: string; full_name: string };
  students: CombinedStudent[];
};

export type CombinedResultsResponse = {
  subject: { id: string; code: string; name: string };
  columns: CombinedColumn[];
  sections: CombinedSectionView[];
};

export type SubjectOption = { id: string; code: string; name: string };
