/* eslint-disable react-hooks/set-state-in-effect -- the exam, its attempts and its audit trail all come from the API and cannot be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdjustmentType } from '@exam/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { describeError, formatDateTime, humanise, plural } from '../admin/adminShared';
import type { ExamDetail } from '../doctor/doctorExamTypes';
import {
  AUDIT_PENDING_UNKNOWN,
  MAX_POINTS,
  PENDING_TAG,
  auditRows,
  buildCompensationPayload,
  canCompensate,
  cohortWarning,
  compensationOutcome,
  pickableQuestions,
  pointsValue,
  validateCompensation,
  type CompensationDraft,
} from './compensationModel';
import type {
  AdjustmentsResponse,
  CompensateResult,
  LiveAttempt,
  LiveResponse,
} from './compensationTypes';

const TYPE_OPTIONS: Array<{ value: AdjustmentType; label: string; help: string }> = [
  {
    value: 'full_credit',
    label: 'Give full credit',
    help: 'Every affected student is awarded the full points this question is worth, whatever they answered.',
  },
  {
    value: 'set_points',
    label: 'Set a fixed number of points',
    help: 'Every affected student is awarded exactly the points you enter, whether they answered correctly or not.',
  },
];

const BACK_LINKS = {
  admin: { to: '/admin/exams', label: 'Back to exams' },
  doctor: { to: '/doctor/exams', label: 'Back to exams' },
  ta: { to: '/ta/quizzes', label: 'Back to quizzes' },
} as const;

// Fixed to two places, not just capped at two: the previous/new column pairs values from the same
// Decimal(6,2) column, and "1.25 -> 2" next to "0 -> 2" misaligns the digits the reader is
// comparing.
function formatPoints(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function signedDelta(delta: number): string {
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : '−'}${formatPoints(Math.abs(delta))}`;
}

/** GET /exams/:id/live and GET .../adjustments are both reachable without a status gate, so all
 *  three loads run together. Only the exam load is fatal: without it there is no title, no
 *  status and therefore no way to phrase any of the answers. */
async function settle<T>(load: Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await load, error: null };
  } catch (caught) {
    return { data: null, error: describeError(caught) };
  }
}

export function ExamCompensationPage() {
  const { examId } = useParams();
  const id = examId ?? '';
  const { user } = useAuth();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  // null, not []: this request can fail on its own while the page works, and an empty array is a
  // claim that the exam has no attempts. That claim reached the cohort warning and the audit trail
  // before, and both of those are sentences about a student's grade.
  const [attempts, setAttempts] = useState<LiveAttempt[] | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentsResponse['adjustments'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<CompensationDraft>({
    questionId: '',
    adjustmentType: 'full_credit',
    points: '',
    scope: '',
    studentExamIds: [],
    reason: '',
  });
  const [studentQuery, setStudentQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CompensateResult | null>(null);

  const load = useCallback(async () => {
    if (id === '') return;
    setLoading(true);
    const [examResult, liveResult, trailResult] = await Promise.all([
      // GET /exams/:id answers { exam }, not a bare exam. Reading body.pool_questions instead of
      // body.exam.pool_questions yields undefined, and because the type claims the field is always
      // present nothing complains until a useMemo calls .map on it in the browser.
      settle(api.get<{ exam: ExamDetail }>(`/exams/${id}`)),
      settle(api.get<LiveResponse>(`/exams/${id}/live`)),
      settle(api.get<AdjustmentsResponse>(`/grade-adjustments/exams/${id}/adjustments`)),
    ]);

    if (examResult.data) {
      setExam(examResult.data.exam);
      setLoadError(null);
    } else {
      setExam(null);
      setLoadError(examResult.error);
    }
    if (liveResult.data) {
      setAttempts(liveResult.data.attempts);
      setAttemptsError(null);
    } else {
      setAttempts(null);
      setAttemptsError(liveResult.error);
    }
    if (trailResult.data) {
      setAdjustments(trailResult.data.adjustments);
      setTrailError(null);
    } else {
      setAdjustments(null);
      setTrailError(trailResult.error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const trail = useMemo(() => auditRows(adjustments, attempts), [adjustments, attempts]);

  const questions = useMemo(
    () => pickableQuestions(exam?.pool_questions, adjustments),
    [exam, adjustments]
  );

  const visibleAttempts = useMemo(() => {
    if (attempts === null) return [];
    const needle = studentQuery.trim().toLowerCase();
    if (needle === '') return attempts;
    return attempts.filter((attempt) =>
      `${attempt.student.full_name} ${attempt.student.student_code ?? ''}`.toLowerCase().includes(needle),
    );
  }, [attempts, studentQuery]);

  const problems = useMemo(() => validateCompensation(draft), [draft]);
  const gate = exam ? canCompensate(exam.status) : { allowed: false, reason: '' };
  const blocked = !gate.allowed || problems.length > 0;
  const chosenQuestion = questions.find((question) => question.id === draft.questionId) ?? null;
  const outcome = result ? compensationOutcome(result) : null;
  const back = user && user.role !== 'student' ? BACK_LINKS[user.role] : null;

  function toggleStudent(studentExamId: string) {
    setDraft((current) => ({
      ...current,
      studentExamIds: current.studentExamIds.includes(studentExamId)
        ? current.studentExamIds.filter((id) => id !== studentExamId)
        : [...current.studentExamIds, studentExamId],
    }));
  }

  async function submit() {
    const payload = buildCompensationPayload(draft);
    if (payload === null) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const applied = await api.post<CompensateResult>(`/grade-adjustments/exams/${id}/compensate`, payload);
      setResult(applied);
      setDraft((current) => ({ ...current, reason: '' }));
      // The trail is the evidence that the write happened, so it is re-read rather than
      // assumed: a compensation that the server applied must be visible here without a reload.
      const refreshed = await settle(api.get<AdjustmentsResponse>(`/grade-adjustments/exams/${id}/adjustments`));
      if (refreshed.data) {
        setAdjustments(refreshed.data.adjustments);
        setTrailError(null);
      } else {
        setTrailError(refreshed.error);
      }
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-stack">
      <Card>
        {back && (
          <p className="muted">
            <Link to={back.to}>{back.label}</Link>
          </p>
        )}
        <div className="results-head">
          <div>
            <h2>{exam ? `Compensate grades — ${exam.title}` : 'Compensate grades'}</h2>
            {exam && (
              <p className="page-intro">
                {exam.subject.code} — {exam.subject.name} · {exam.type === 'doctor_exam' ? 'Exam' : 'Quiz'} by{' '}
                {exam.owner.full_name} · {formatPoints(pointsValue(exam.points_per_question))} points per question
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div>
            <Spinner label="Loading exam" /> Loading…
          </div>
        ) : loadError ? (
          <Alert>{loadError}</Alert>
        ) : exam ? (
          <div className="form-stack">
            {!gate.allowed && <Alert variant="info">{gate.reason}</Alert>}

            <fieldset className="fieldset-reset" disabled={!gate.allowed}>
              <legend>New compensation</legend>

              <Field label="Question to compensate" htmlFor="comp-question">
                <Select
                  id="comp-question"
                  value={draft.questionId}
                  onChange={(event) => setDraft({ ...draft, questionId: event.target.value })}
                >
                  <option value="">Choose a question…</option>
                  {questions.map((question) => (
                    <option key={question.id} value={question.id}>
                      {question.text}
                    </option>
                  ))}
                </Select>
              </Field>

              <fieldset className="ui-field fieldset-reset">
                <legend>Adjustment</legend>
                {TYPE_OPTIONS.map((option) => (
                  <label className="scope-row" key={option.value}>
                    <input
                      type="radio"
                      name="adjustment-type"
                      value={option.value}
                      checked={draft.adjustmentType === option.value}
                      onChange={() =>
                        setDraft({ ...draft, adjustmentType: option.value, points: option.value === 'set_points' ? draft.points : '' })
                      }
                    />
                    <span>
                      {option.label}
                      <span className="option-preview">{option.help}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {draft.adjustmentType === 'set_points' && (
                <Field
                  label="Points to award"
                  htmlFor="comp-points"
                >
                  <Input
                    id="comp-points"
                    inputMode="decimal"
                    value={draft.points}
                    placeholder="for example 1.5"
                    onChange={(event) => setDraft({ ...draft, points: event.target.value })}
                  />
                  <span className="option-preview">
                    Between 0 and {MAX_POINTS}, with at most 2 decimal places. This is the storage ceiling, not a
                    policy limit: the exam scores {formatPoints(pointsValue(exam.points_per_question))} per question,
                    and the specification does not settle whether a question may be worth more than that.
                  </span>
                </Field>
              )}

              <fieldset className="ui-field fieldset-reset">
                <legend>Who it applies to</legend>
                <label className="scope-row">
                  <input
                    type="radio"
                    name="comp-scope"
                    checked={draft.scope === 'all'}
                    onChange={() => setDraft({ ...draft, scope: 'all', studentExamIds: [] })}
                  />
                  <span>
                    Everyone who received this question
                    <span className="option-preview">
                      Every student whose sample included it. This is the wider of the two, so it is never selected
                      for you.
                    </span>
                  </span>
                </label>
                <label className="scope-row">
                  <input
                    type="radio"
                    name="comp-scope"
                    checked={draft.scope === 'selected'}
                    onChange={() => setDraft({ ...draft, scope: 'selected' })}
                  />
                  <span>
                    Specific students only
                    <span className="option-preview">
                      {attempts === null
                        ? 'The attempt list could not be loaded, so there is nothing to choose from here.'
                        : attempts.length === 0
                          ? 'No attempts are on file for this exam, so there is nobody to choose yet.'
                          : `${plural(attempts.length, 'attempts')} on file.`}
                    </span>
                  </span>
                </label>
              </fieldset>

              {draft.scope === 'all' && chosenQuestion && (
                <p className="comp-warn">{cohortWarning(chosenQuestion.text, attempts?.length ?? null)}</p>
              )}

              {draft.scope === 'selected' && (
                <div className="ui-field">
                  <Field label="Search students" htmlFor="comp-student-search">
                    <Input
                      id="comp-student-search"
                      value={studentQuery}
                      placeholder="Search for students here"
                      onChange={(event) => setStudentQuery(event.target.value)}
                    />
                  </Field>
                  {attemptsError ? (
                    <Alert>{attemptsError}</Alert>
                  ) : attempts === null ? (
                    <p className="muted">The attempt list could not be loaded.</p>
                  ) : visibleAttempts.length === 0 ? (
                    <p className="muted">
                      {attempts.length === 0
                        ? 'No attempts are on file for this exam.'
                        : 'No students match this search.'}
                    </p>
                  ) : (
                    <>
                      <ul className="pick-list">
                        {visibleAttempts.map((attempt) => (
                          <li key={attempt.student_exam_id}>
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={draft.studentExamIds.includes(attempt.student_exam_id)}
                                onChange={() => toggleStudent(attempt.student_exam_id)}
                              />
                              <span>
                                <span className="pick-meta">{humanise(attempt.status)}</span>
                                {attempt.student.full_name}
                                <span className="muted"> {attempt.student.student_code ?? '—'}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <span className="option-preview">
                        {draft.studentExamIds.length === 0
                          ? 'Nobody is selected yet.'
                          : `${plural(draft.studentExamIds.length, 'students')} selected.`}
                      </span>
                    </>
                  )}
                </div>
              )}

              <Field label="Reason" htmlFor="comp-reason">
                <Textarea
                  id="comp-reason"
                  value={draft.reason}
                  placeholder="Recorded in the audit trail against every affected student"
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
              </Field>

              {problems.length > 0 && (
                <ul className="requirement-list">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}

              <div className="row-actions">
                <Button type="button" disabled={blocked || submitting} onClick={() => void submit()}>
                  {submitting ? 'Applying…' : 'Apply compensation'}
                </Button>
                {gate.allowed && problems.length === 0 && (
                  <span className="muted">
                    This writes an audit row per affected student and cannot be undone from here.
                  </span>
                )}
              </div>
            </fieldset>

            {submitError && <Alert>{submitError}</Alert>}

            {result && outcome && (
              <Alert variant="success">
                <strong>
                  {plural(result.adjustmentCount, 'adjustments')} recorded.
                </strong>{' '}
                {outcome.detail}
              </Alert>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <h3>Audit trail</h3>
        <p className="muted">
          Every compensation ever applied to this exam, newest first, with who did it and why.
        </p>
        <div className="stacked-card">
          {trailError ? (
            <Alert>{trailError}</Alert>
          ) : loading ? (
            <div>
              <Spinner label="Loading audit trail" /> Loading…
            </div>
          ) : trail.length === 0 ? (
            <p className="muted">No grade compensation has been applied to this exam.</p>
          ) : (
            <>
              {attempts === null && (
                <p className="option-preview">{AUDIT_PENDING_UNKNOWN}</p>
              )}
              <Table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Student</th>
                  <th>Question</th>
                  <th>Change</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {trail.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.actor_name}</td>
                    <td>
                      <div className="question-text">{row.student_name}</div>
                      <span className="muted">{row.student_code ?? '—'}</span>
                    </td>
                    <td>
                      <div className="question-text">{row.question_text}</div>
                      <span className="muted">{row.adjustment_type === 'full_credit' ? 'full credit' : 'fixed points'}</span>
                    </td>
                    <td className="grade-cell">
                      <span>
                        {formatPoints(row.previous_points)} → {formatPoints(row.new_points)}
                      </span>{' '}
                      <span className={row.delta > 0 ? 'delta delta--up' : row.delta < 0 ? 'delta delta--down' : 'delta'}>
                        {signedDelta(row.delta)}
                      </span>
                      {row.pending && <span className="pending-tag">{PENDING_TAG}</span>}
                    </td>
                    <td>
                      <div className="question-text">{row.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </Table>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
