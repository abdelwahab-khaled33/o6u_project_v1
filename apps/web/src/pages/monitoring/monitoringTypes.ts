/**
 * The shapes GET /exams/:examId/live, GET /exams/:examId/access-code and
 * POST /exams/:examId/attempts/:studentExamId/release return, read off
 * apps/api/src/routes/exams.ts.
 *
 * LiveAttempt mirrors the one in ../compensation/compensationTypes. It is declared
 * again rather than imported because that copy types `status` as a bare string (the
 * compensation page filters on it defensively), while a monitoring screen needs the
 * four real values to build a census; importing one page's types into another page
 * would couple two features that share nothing else.
 */
export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted';

export type LiveAttempt = {
  student_exam_id: string;
  student: { id: string; full_name: string; student_code: string | null };
  status: AttemptStatus;
  answered_count: number;
  deadline_at: string | null;
  has_active_session: boolean;
  /**
   * Present only for in_progress attempts — the route spreads it in conditionally, so
   * its absence is not the same claim as `false` and must not be read as one.
   */
  online?: boolean;
};

export type LiveResponse = { exam_id: string; attempts: LiveAttempt[] };

/** The only response in the platform that carries the plaintext code. */
export type AccessCodeResponse = { access_code: string; access_code_expires_at: string | null };

export type ReleaseResponse = { ok: boolean; message: string };

/** An ApiError reduced to what these pages branch on. `status` is null when no HTTP response arrived. */
export type RequestFailure = { status: number | null; message: string };