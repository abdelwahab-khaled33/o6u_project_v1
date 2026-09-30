/* eslint-disable react-hooks/set-state-in-effect -- the exam list comes from the API and cannot be derived during render */
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
import { formatGrade } from './DoctorQuestionForm';
import {
  canDeleteExam,
  isUpcoming,
  STATUS_LABELS,
  type ExamStatus,
  type ExamSummary,
} from './doctorExamTypes';

const STATUS_FILTERS: { value: ExamStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending_approval', label: 'Waiting for approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

type NavState = { notice?: string };

export function DoctorExamsPage() {
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

  async function deleteExam(exam: ExamSummary) {
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
        <h2>Exams</h2>
        <p className="page-intro">
          Every exam you created, newest first. An exam you author needs an administrator to approve it, and
          editing an approved exam sends it back for approval, so students keep the version that was approved.
        </p>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        <div className="form-stack">
          <div className="filter-bar">
            <Field label="Status" htmlFor="doctor-exam-status">
              <Select
                id="doctor-exam-status"
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
              <Button onClick={() => navigate('/doctor/exams/new')}>New exam</Button>
            </div>
          </div>

          {loading ? (
            <div><Spinner label="Loading exams" /> Loading exams…</div>
          ) : visibleExams.length === 0 ? (
            <EmptyState>
              {exams.length === 0
                ? 'You have not created an exam yet. Build one with the New exam button above.'
                : 'No exams match this status filter.'}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Exam</th>
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
                        {exam.status === 'rejected' && exam.rejection_reason && (
                          <p className="muted">Rejected: {exam.rejection_reason}</p>
                        )}
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
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/doctor/results/${exam.id}`)}
                          >
                            Results
                          </Button>
                          {/* Reachable while the exam is still running, which results is not (§4.5). */}
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/doctor/exams/${exam.id}/compensate`)}
                          >
                            Compensate
                          </Button>
                          {/* Both of these are needed at a time results is not: the code from
                              approval onward, and the monitor only while the exam runs. */}
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/doctor/exams/${exam.id}/access-code`)}
                          >
                            Access code
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/doctor/exams/${exam.id}/live`)}
                          >
                            Monitor
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!upcoming}
                            title={upcoming
                              ? 'Edit this exam'
                              : 'An exam cannot be edited once its start time has passed'}
                            onClick={() => navigate(`/doctor/exams/${exam.id}/edit`)}
                          >
                            Edit
                          </Button>
                          {confirmDelete === exam.id ? (
                            <>
                              <span className="muted">Delete this exam?</span>
                              <Button
                                variant="danger"
                                disabled={busyId === exam.id}
                                onClick={() => { void deleteExam(exam); }}
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
                                ? 'Delete this exam'
                                : 'An approved exam cannot be deleted once it has started'}
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

          <p className="muted">
            Points per question and the counts above come back as text because the database stores them as
            decimals; they are read as numbers before display.{' '}
            <Link to="/doctor/question-bank">Question bank</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
