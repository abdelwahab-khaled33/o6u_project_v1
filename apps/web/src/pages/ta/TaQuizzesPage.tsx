/* eslint-disable react-hooks/set-state-in-effect -- the quiz list and the roster of live attempts both come from the API and cannot be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, EmptyState, formatDateTime, humanise, plural } from '../admin/adminShared';
import { formatGrade } from '../doctor/DoctorQuestionForm';
import { canDeleteExam, isUpcoming, STATUS_LABELS, type ExamStatus, type ExamSummary } from '../doctor/doctorExamTypes';

type NavState = { notice?: string };

const STATUS_FILTERS: { value: ExamStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'approved', label: 'Live' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
];

type LiveAttempt = {
  student_exam_id: string;
  student: { id: string; full_name: string; student_code: string | null };
  status: string;
  answered_count: number;
  deadline_at: string | null;
  has_active_session: boolean;
};

type AccessCode = { access_code: string; access_code_expires_at: string };

export function TaQuizzesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state as NavState | null)?.notice;

  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [status, setStatus] = useState<ExamStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(incoming ?? null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [liveFor, setLiveFor] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<LiveAttempt[]>([]);
  const [loadingLive, setLoadingLive] = useState(false);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState<AccessCode | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      setExams((await api.get<{ exams: ExamSummary[] }>('/exams')).exams);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadExams(); }, [loadExams]);

  const visibleExams = useMemo(
    () => (status === '' ? exams : exams.filter((exam) => exam.status === status)),
    [exams, status],
  );

  async function toggleLive(examId: string) {
    if (liveFor === examId) {
      setLiveFor(null);
      setAttempts([]);
      return;
    }
    setLiveFor(examId);
    setAttempts([]);
    setLoadingLive(true);
    setError(null);
    try {
      const result = await api.get<{ attempts: LiveAttempt[] }>(`/exams/${examId}/live`);
      setAttempts(result.attempts);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingLive(false);
    }
  }

  async function revealCode(examId: string) {
    if (codeFor === examId) {
      setCodeFor(null);
      setCode(null);
      return;
    }
    setCodeFor(examId);
    setCode(null);
    setCodeError(null);
    try {
      // The only route that returns the plaintext; every other exam response uses a select that omits it.
      setCode(await api.get<AccessCode>(`/exams/${examId}/access-code`));
    } catch (caught) {
      setCodeError(describeError(caught));
    }
  }

  async function deleteQuiz(exam: ExamSummary) {
    setBusyId(exam.id);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/exams/${exam.id}`);
      setConfirmDelete(null);
      setNotice(`Deleted "${exam.title}".`);
      await loadExams();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Card>
        <h2>Quizzes</h2>
        <p className="page-intro">
          Every quiz you created. A quiz does not wait for an administrator: it is live as soon as it is created,
          students reach it with the access code below, and you decide who it targets. You cannot target a whole
          subject — a quiz is built for your own sections, or for a list of your own students.
        </p>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        <div className="form-stack">
          <div className="filter-bar">
            <Field label="Status" htmlFor="ta-quiz-status">
              <Select
                id="ta-quiz-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as ExamStatus | '');
                  setConfirmDelete(null);
                }}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </Select>
            </Field>
            <div className="row-actions">
              <Button onClick={() => navigate('/ta/quizzes/new')}>New quiz</Button>
            </div>
          </div>

          {loading ? (
            <div><Spinner label="Loading quizzes" /> Loading quizzes…</div>
          ) : visibleExams.length === 0 ? (
            <EmptyState>
              {exams.length === 0
                ? 'You have not created a quiz yet. Build one with the New quiz button above.'
                : 'No quizzes match this status filter.'}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Quiz</th>
                  <th>Status</th>
                  <th>Each student answers</th>
                  <th>Scoring</th>
                  <th>Window</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleExams.map((exam) => {
                  const upcoming = isUpcoming(exam.start_time);
                  const mix = exam.difficulty_mix;
                  return (
                    <tr key={exam.id}>
                      <td>
                        <div className="question-text">{exam.title}</div>
                        <span className="muted">
                          {exam.subject.code} — {exam.subject.name} · {plural(exam._count.pool_questions, 'questions')} in the pool
                        </span>
                        <div className="muted">
                          {humanise(exam.quiz_source ?? 'shared_bank')} · {plural(exam._count.student_exams, 'attempts')} generated
                        </div>
                      </td>
                      <td>
                        <span className={`status status--${exam.status}`}>
                          {STATUS_LABELS[exam.status]}
                        </span>
                        <div className="muted">{humanise(exam.target_scope)}</div>
                      </td>
                      <td>
                        {['easy', 'medium', 'hard'].map((tier) => (
                          <div key={tier}>{tier}: {mix[tier as keyof typeof mix]}</div>
                        ))}
                        <div className="muted">{exam.duration_minutes} min</div>
                      </td>
                      <td>{formatGrade(exam.points_per_question)} pts</td>
                      <td>
                        <div>{formatDateTime(exam.start_time)}</div>
                        <div className="muted">to {formatDateTime(exam.end_time)}</div>
                        {!upcoming && <div className="muted">Already started</div>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <Button variant="secondary" onClick={() => { void revealCode(exam.id); }}>
                            {codeFor === exam.id ? 'Hide code' : 'Access code'}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!upcoming}
                            title={upcoming
                              ? 'Edit this quiz'
                              : 'A quiz cannot be edited once its start time has passed'}
                            onClick={() => navigate(`/ta/quizzes/${exam.id}/edit`)}
                          >
                            Edit
                          </Button>
                          <Button variant="secondary" onClick={() => { void toggleLive(exam.id); }}>
                            {liveFor === exam.id ? 'Hide progress' : 'Progress'}
                          </Button>
                          <Button variant="secondary" onClick={() => navigate(`/ta/quizzes/${exam.id}/results`)}>
                            Results
                          </Button>
                          {confirmDelete === exam.id ? (
                            <>
                              <span className="muted">Delete this quiz?</span>
                              <Button
                                variant="danger"
                                disabled={busyId === exam.id}
                                onClick={() => { void deleteQuiz(exam); }}
                              >
                                {busyId === exam.id ? 'Deleting…' : 'Confirm delete'}
                              </Button>
                              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                            </>
                          ) : (
                            <Button
                              variant="danger"
                              disabled={!canDeleteExam(exam)}
                              title={canDeleteExam(exam)
                                ? 'Delete this quiz'
                                : 'A live quiz cannot be deleted once it has started'}
                              onClick={() => {
                                setConfirmDelete(exam.id);
                                setNotice(null);
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {codeFor !== null && (
            <div className="form-stack">
              {codeError && <Alert>{codeError}</Alert>}
              {code && (
                <p>
                  Access code <strong>{code.access_code}</strong>, valid until {formatDateTime(code.access_code_expires_at)}.
                  Students type this to start. It is shown here and nowhere else, and the page only fetches it when
                  you ask.
                </p>
              )}
            </div>
          )}

          {liveFor !== null && (
            <section>
              <h3>Progress</h3>
              {loadingLive ? (
                <div><Spinner label="Loading attempts" /> Loading attempts…</div>
              ) : attempts.length === 0 ? (
                <EmptyState>No attempts have been generated for this quiz yet.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Status</th>
                      <th>Answered</th>
                      <th>Deadline</th>
                      <th>Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((attempt) => (
                      <tr key={attempt.student_exam_id}>
                        <td>
                          <div>{attempt.student.full_name}</div>
                          <div className="muted">{attempt.student.student_code ?? '—'}</div>
                        </td>
                        <td><span className={`status status--${attempt.status}`}>{humanise(attempt.status)}</span></td>
                        <td>{attempt.answered_count}</td>
                        <td>{formatDateTime(attempt.deadline_at)}</td>
                        <td className="muted">{attempt.has_active_session ? 'Active' : 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
          )}

          <p className="muted">
            Points per question comes back as text because the database stores it as a decimal; it is read as a
            number before display. Questions come from the <Link to="/ta/question-bank">shared question bank</Link>.
          </p>
        </div>
      </Card>
    </div>
  );
}
