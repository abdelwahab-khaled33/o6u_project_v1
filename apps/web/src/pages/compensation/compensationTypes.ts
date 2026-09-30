import type { AdjustmentType } from '@exam/shared';

/**
 * The shapes the two grade-adjustment routes return, read off
 * apps/api/src/routes/grade-adjustments.ts.
 *
 * previous_points and new_points are `Decimal(6,2)` in the schema, so JSON.stringify
 * of a Prisma Decimal yields a string ("2.00"). They are typed `number | string` and read
 * through pointsValue(); the same trap applies to Exam.points_per_question.
 */
export type AuditRow = {
  id: string;
  adjustment_type: AdjustmentType;
  reason: string;
  previous_points: number | string;
  new_points: number | string;
  created_at: string;
  student_exam_question: {
    id: string;
    question_id: string;
    text: string;
    student_exam: {
      id: string;
      student: { id: string; full_name: string; student_code: string | null };
    };
  };
  actor: { id: string; full_name: string };
};

export type AdjustmentsResponse = { adjustments: AuditRow[] };

/** applyGradeCompensation returns adjustmentCount and totalGradeRecalculated; the route adds its message. */
export type CompensateResult = {
  message: string;
  adjustmentCount: number;
  totalGradeRecalculated: number;
};

/** One row of GET /exams/:id/live, the only existing endpoint that exposes the StudentExam id. */
export type LiveAttempt = {
  student_exam_id: string;
  student: { id: string; full_name: string; student_code: string | null };
  status: string;
  answered_count: number;
  deadline_at: string | null;
  has_active_session: boolean;
  /** Only present for in_progress attempts; the route computes it from last_heartbeat_at. */
  online?: boolean;
};

export type LiveResponse = { exam_id: string; attempts: LiveAttempt[] };

/** The exact body of POST /grade-adjustments/exams/:examId/compensate. */
export type CompensateBody = {
  source_question_id: string;
  adjustment_type: AdjustmentType;
  reason: string;
  points?: number;
  student_exam_ids?: string[];
};

/** A question as the picker offers it. Only the id and the text are kept: the audit trail names
 *  a question the route does not report a difficulty for, and inventing one would put a false
 *  value in the DOM. */
export type PickableQuestion = { id: string; text: string };
