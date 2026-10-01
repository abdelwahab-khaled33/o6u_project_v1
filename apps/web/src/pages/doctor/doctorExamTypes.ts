import type { Difficulty, QuestionType } from '@exam/shared';

/** The shapes the exams routes actually return, taken from EXAM_LIST_SELECT and EXAM_DETAIL_SELECT in
 *  apps/api/src/services/exam-selects.ts and confirmed against the running server. points_per_question
 *  is Prisma Decimal, so JSON gives a string: it is typed number | string and read through Number(). */

export type ExamStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'locked' | 'closed';

export type DifficultyMixValue = { easy: number; medium: number; hard: number };

export type ExamSubject = { id: string; code: string; name: string };

export type ExamSummary = {
  id: string;
  subject_id: string;
  type: 'doctor_exam' | 'ta_quiz';
  title: string;
  status: ExamStatus;
  rejection_reason: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  difficulty_mix: DifficultyMixValue;
  points_per_question: number | string;
  target_scope: 'subject' | 'sections' | 'student_list';
  quiz_source: string | null;
  created_at: string;
  subject: ExamSubject;
  owner: { id: string; full_name: string };
  _count: { pool_questions: number; student_exams: number };
};

export type ExamDetail = {
  id: string;
  subject_id: string;
  type: 'doctor_exam' | 'ta_quiz';
  title: string;
  status: ExamStatus;
  rejection_reason: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  difficulty_mix: DifficultyMixValue;
  points_per_question: number | string;
  target_scope: 'subject' | 'sections' | 'student_list';
  /** null for a doctor exam. A TA quiz always carries one of the two quiz_source values; confirmed live,
   *  because POST /exams as a TA without it is 400 "quiz_source is required for TA quizzes". */
  quiz_source: string | null;
  created_at: string;
  updated_at: string;
  subject: ExamSubject;
  owner: { id: string; full_name: string };
  pool_questions: {
    exam_id: string;
    question_id: string;
    question: { id: string; text: string; difficulty: Difficulty; question_type: QuestionType; is_archived: boolean };
  }[];
  target_sections: { exam_id: string; section_id: string }[];
  target_students: { exam_id: string; student_id: string }[];
};

export const STATUS_LABELS: Record<ExamStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  locked: 'Locked',
  closed: 'Closed',
};

/** Matches isUpcoming in apps/api/src/routes/exams.ts. Used only to explain the server's rules before the
 *  click; the server still decides, and its 409 is what the user sees if the two ever disagree. */
export function isUpcoming(startTime: string, now: number = Date.now()): boolean {
  const start = new Date(startTime).getTime();
  if (Number.isNaN(start)) return false;
  return now < start;
}

/** A doctor can delete an exam that has not started, or one that was never approved. Both halves come
 *  from the DELETE handler. */
export function canDeleteExam(exam: { start_time: string; status: ExamStatus }, now: number = Date.now()): boolean {
  return isUpcoming(exam.start_time, now) || exam.status !== 'approved';
}

/** Whether to offer the Resubmit button. Two halves, and both are load-bearing.
 *
 *  The status half comes from the route: exams.ts answers 409 unless the exam is `rejected`, so any
 *  other status would offer a button whose only possible result is a refusal.
 *
 *  The time half is ours, not the server's: the resubmit route has no time gate at all, so a rejected
 *  exam that already started could be pushed back into the queue and only fail later, at the
 *  administrator's desk, who would then be looking at an exam whose window is closed. Gating the
 *  button on `isUpcoming` keeps that failure at the doctor's screen where they can still delete the
 *  exam instead. Approval itself already refuses ended exams; this is about not creating the queue
 *  entry. The server still decides, and its 409 is what the user sees if the two ever disagree. */
export function canResubmit(status: ExamStatus, startTime: string, now: number = Date.now()): boolean {
  return status === 'rejected' && isUpcoming(startTime, now);
}

/** What resubmitting actually did. The route changes the status to `pending_approval` and clears
 *  `rejection_reason`; nothing else about the exam changes, so the notice may not claim it is approved
 *  or that its contents were checked. */
export function resubmitNotice(title: string): string {
  return `Resubmitted "${title}". It is back with the administrator for approval.`;
}

export function pointsValue(points: number | string): number {
  const parsed = Number(points);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** What PATCH actually did to the status. exams.ts:504-506 computes
 *  `newStatus = doctorEditsApproved ? 'pending_approval' : existing.status`, so only an exam that was
 *  `approved` goes back into the queue. Every other status is kept, and a rejected exam cannot be
 *  approved at all because admin-exams.ts:49 only accepts `pending_approval`. Saying "back with the
 *  administrator for approval" unconditionally therefore told a doctor with a rejected exam that
 *  something the API does not do had happened. Verified live, not inferred. */
export function editOutcomeNotice(status: ExamStatus, title: string): string {
  const prefix = `Updated "${title}".`;
  if (status === 'approved') return `${prefix} It is back with the administrator for approval.`;
  if (status === 'pending_approval') return `${prefix} It is still waiting for an administrator to approve it.`;
  if (status === 'rejected') return `${prefix} It is still rejected, so it has not gone back for approval.`;
  return `${prefix} Its status is still ${STATUS_LABELS[status]}.`;
}

/** The same rule, said before the save rather than after it. PATCH clears every StudentExam row for
 *  the exam unconditionally (exams.ts:556), so that part is true for every status. */
export function editOutcomeExplainer(status: ExamStatus | null): string {
  const clears = 'Saving also clears the attempts already generated for it.';
  if (status === 'approved') {
    return 'Saving sends this exam back to an administrator for approval. ' + clears;
  }
  if (status === 'pending_approval') {
    return 'This exam is still waiting for an administrator to approve it, and saving leaves it in that queue. ' + clears;
  }
  if (status === 'rejected') {
    return 'Saving does not put a rejected exam back in the queue: an administrator can only approve an exam that is waiting. '
      + 'Correct it, then use Resubmit to put it back in the queue. ' + clears;
  }
  if (status === null) {
    return 'Saving keeps the status this exam already has. ' + clears;
  }
  return `Saving keeps this exam at its current status, ${STATUS_LABELS[status]}. ` + clears;
}
