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
import { STATUS_PILL, statusTone } from '../../lib/statusTone';
import { describeError, EmptyState, formatDateTime, humanise, plural } from '../admin/adminShared';
import { formatGrade } from './DoctorQuestionForm';
import {
  canDeleteExam,
  canResubmit,
  isUpcoming,
  resubmitNotice,
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
  const [confirmResubmit, setConfirmResubmit] = useState<string | null>(null);
  const [resubmitted, setResubmitted] = useState<Record<string, string>>({});
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

  async function resubmitExam(exam: ExamSummary) {
    setBusyId(exam.id);
    setError(null);
    setNotice(null);
    try {
      // The route's schema is strict and the body is empty, so {} is the whole payload: the route
      // changes the status to pending_approval and clears rejection_reason, and nothing else.
      await api.post(`/exams/${exam.id}/resubmit`, {});
      setConfirmResubmit(null);
      // Per-row, not the page-level notice: every mutation on this page clears that one, so an
      // approve or a delete on a different row would wipe a sentence somebody is still reading.
      setResubmitted((previous) => ({ ...previous, [exam.id]: resubmitNotice(exam.title) }));
      await loadExams();
    } catch (caught) {
      // The confirm buttons are cleared on the failure path too, which deleteExam does not do: a
      // refusal would otherwise leave them on screen inviting a retry of the same refused action,
      // and the reason would have to be read off a button the doctor is being pushed to press.
      setConfirmResubmit(null);
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Card>
        <h2>Exams</h2>
        <p className="font-normal text-muted">
          Every exam you created, newest first. An exam you author needs an administrator to approve it, and
          editing an approved exam sends it back for approval, so students keep the version that was approved.
        </p>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        <div className="mt-5 grid gap-[18px]">
          <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
            <Field label="Status" htmlFor="doctor-exam-status">
              <Select
                id="doctor-exam-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as ExamStatus | '');
                  setConfirmDelete(null);
                  setConfirmResubmit(null);
                }}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
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
                        <div className="max-w-[460px] [overflow-wrap:anywhere]">{exam.title}</div>
                        <span className="font-normal text-muted">
                          {exam.subject.code} — {exam.subject.name} · {plural(exam._count.pool_questions, 'questions')} in the pool
                        </span>
                        {exam.status === 'rejected' && exam.rejection_reason && (
                          <p className="font-normal text-muted">Rejected: {exam.rejection_reason}</p>
                        )}
                        {resubmitted[exam.id] && (
                          <p className="font-normal text-muted">{resubmitted[exam.id]}</p>
                        )}
                      </td>
                      <td>
                        <span className={`${STATUS_PILL} ${statusTone(exam.status)}`}>
                          {STATUS_LABELS[exam.status]}
                        </span>
                        <div className="font-normal text-muted">{humanise(exam.target_scope)}</div>
                      </td>
                      <td>
                        {['easy', 'medium', 'hard'].map((tier) => (
                          <div key={tier}>{tier}: {mix[tier as keyof typeof mix]}</div>
                        ))}
                        <div className="font-normal text-muted">{exam.duration_minutes} min</div>
                      </td>
                      <td>{formatGrade(exam.points_per_question)} pts</td>
                      <td>
                        <div>{formatDateTime(exam.start_time)}</div>
                        <div className="font-normal text-muted">to {formatDateTime(exam.end_time)}</div>
                        {!upcoming && <div className="font-normal text-muted">Already started</div>}
                      </td>
                      <td>
                        <div className="table-actions flex flex-wrap items-center gap-2">
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
                          {/* Only a rejected exam can be resubmitted at all, and only while it has not
                              started — see canResubmit. For any other status the button is absent
                              rather than disabled, because resubmitting it is not a thing this exam
                              could ever need. */}
                          {exam.status === 'rejected' && (confirmResubmit === exam.id ? (
                            <>
                              <span className="font-normal text-muted">Resubmit this exam?</span>
                              <Button
                                variant="primary"
                                disabled={busyId === exam.id}
                                onClick={() => { void resubmitExam(exam); }}
                              >
                                {busyId === exam.id ? 'Resubmitting…' : 'Confirm resubmit'}
                              </Button>
                              <Button variant="secondary" onClick={() => setConfirmResubmit(null)}>Cancel</Button>
                            </>
                          ) : (
                            <Button
                              variant="primary"
                              disabled={!canResubmit(exam.status, exam.start_time)}
                              title={canResubmit(exam.status, exam.start_time)
                                ? 'Put this rejected exam back in the approval queue. This only changes its status and clears the reason it was rejected.'
                                : 'This exam has already started, so resubmitting it would only queue an exam an administrator cannot approve in time. Delete it instead.'}
                              onClick={() => {
                                setConfirmResubmit(exam.id);
                                setNotice(null);
                              }}
                            >
                              Resubmit
                            </Button>
                          ))}
                          {confirmDelete === exam.id ? (
                            <>
                              <span className="font-normal text-muted">Delete this exam?</span>
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

          <p className="font-normal text-muted">
            Points per question and the counts above come back as text because the database stores them as
            decimals; they are read as numbers before display.{' '}
            <Link to="/doctor/question-bank">Question bank</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
