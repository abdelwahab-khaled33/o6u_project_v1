/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import {
  buildRegeneratePayload,
  canRegenerate,
  regenerateNotice,
  regenerateProblem,
  type RegenerateNotice,
} from './adminAccessCodeModel';
import {
  describeError,
  EmptyState,
  formatDateTime,
  formValue,
  humanise,
  type AdminExam,
} from './adminShared';

type ExamTypeFilter = 'doctor_exam' | 'ta_quiz' | 'all';

/**
 * The route returns the whole EXAM_DETAIL_SELECT object under `exam`. Only the expiry is read
 * here, so only the expiry is typed: declaring the full projection would make a rename in the
 * server's select look like a change this screen has to make.
 */
type RegenerateResponse = {
  access_code: string;
  exam: { access_code_expires_at: string | null };
};

const STATUS_OPTIONS = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All statuses' },
];

const TYPE_OPTIONS: Array<{ value: ExamTypeFilter; label: string }> = [
  { value: 'doctor_exam', label: 'Doctor-authored exams' },
  { value: 'ta_quiz', label: 'TA quizzes' },
  { value: 'all', label: 'All types' },
];

export function AdminExamsPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [status, setStatus] = useState('pending_approval');
  const [typeFilter, setTypeFilter] = useState<ExamTypeFilter>('doctor_exam');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotatingExpiry, setRotatingExpiry] = useState('');
  const [rotatingProblem, setRotatingProblem] = useState<string | null>(null);
  // Keyed by exam id rather than kept in the page-level `notice`, which every mutation clears
  // first: an approval or rejection on another row would wipe a code somebody is reading out.
  // The composed sentence is stored rather than rebuilt on each render, so what stays on screen
  // is what the rotation actually said — re-deriving it later against a later clock would
  // quietly rewrite the words underneath whoever is reading them.
  const [rotated, setRotated] = useState<Record<string, RegenerateNotice>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    try {
      const result = await api.get<{ exams: AdminExam[] }>(`/admin/exams${query}`);
      setExams(typeFilter === 'all' ? result.exams : result.exams.filter((exam) => exam.type === typeFilter));
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [status, typeFilter]);

  useEffect(() => { void loadExams(); }, [loadExams]);

  async function approve(exam: AdminExam) {
    setBusyId(exam.id);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/admin/exams/${exam.id}/approve`);
      setNotice(`Approved ${exam.title}.`);
      await loadExams();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(event: FormEvent<HTMLFormElement>, exam: AdminExam) {
    event.preventDefault();
    setBusyId(exam.id);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/admin/exams/${exam.id}/reject`, { reason: formValue(form, 'reason').trim() });
      setNotice(`Rejected ${exam.title}.`);
      setRejectingId(null);
      await loadExams();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  function openRotation(exam: AdminExam) {
    setRotatingId(exam.id);
    setRotatingExpiry('');
    setRotatingProblem(null);
  }

  async function regenerate(event: FormEvent<HTMLFormElement>, exam: AdminExam) {
    event.preventDefault();
    // Read the clock once, inside the handler. It cannot be read during render — that is an
    // impure read under react-hooks/purity — and the value typed a minute ago can already be
    // past, so the check while typing is not the check that decides to send.
    const now = Date.now();
    const problem = regenerateProblem(rotatingExpiry, now, exam.end_time);
    setRotatingProblem(problem);
    if (problem !== null) return;

    const body = buildRegeneratePayload(rotatingExpiry, now, exam.end_time);
    if (body === null) return;

    setBusyId(exam.id);
    setError(null);
    try {
      const result = await api.post<RegenerateResponse>(
        `/admin/exams/${exam.id}/access-code/regenerate`,
        body,
      );
      setRotated((previous) => ({
        ...previous,
        [exam.id]: regenerateNotice(
          result.access_code,
          result.exam.access_code_expires_at,
          formatDateTime,
          now,
        ),
      }));
      setRotatingId(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <h2>Exams</h2>
      <p className="font-normal text-muted">
        Doctor-authored exams need approval; TA quizzes do not and appear once a TA creates them. Rejection reasons must contain at least 3 characters after trimming.
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <div className="mt-5 grid gap-[18px]">
        <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
          <Field label="Type" htmlFor="exam-type">
            <Select id="exam-type" value={typeFilter} onChange={(event) => { setLoading(true); setTypeFilter(event.target.value as ExamTypeFilter); }}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="exam-status">
            <Select id="exam-status" value={status} onChange={(event) => { setLoading(true); setStatus(event.target.value); }}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </div>
        {loading ? (
          <div><Spinner label="Loading exams" /> Loading exams…</div>
        ) : exams.length === 0 ? (
          <EmptyState>No exams found for this type and status.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Subject</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => {
                // Read once: TypeScript cannot narrow a Record lookup keyed by a property path,
                // so reaching for rotated[exam.id] again in the JSX would be two unchecked reads.
                const rotation = rotated[exam.id];
                return (
                  <tr key={exam.id}>
                    <td>{exam.title}</td>
                    <td>{humanise(exam.type)}</td>
                    <td>{exam.subject.code} — {exam.subject.name}</td>
                    <td>{exam.owner.full_name}</td>
                    <td>{humanise(exam.status)}</td>
                    <td>{formatDateTime(exam.start_time)}</td>
                    <td>{formatDateTime(exam.end_time)}</td>
                    <td>
                      <div className="table-actions flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={() => navigate(`/admin/exams/${exam.id}/review`)}>
                          Review
                        </Button>
                        <Button variant="secondary" onClick={() => navigate(`/admin/results/${exam.id}`)}>
                          Results
                        </Button>
                        {/* Reachable while the exam is still running, which results is not (§4.5). */}
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/admin/exams/${exam.id}/compensate`)}
                        >
                          Compensate
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/admin/exams/${exam.id}/live`)}
                        >
                          Monitor
                        </Button>
                      </div>
                      {exam.status === 'pending_approval' && (
                        <>
                          <div className="table-actions flex flex-wrap items-center gap-2">
                            <Button disabled={busyId === exam.id} onClick={() => { void approve(exam); }}>
                              {busyId === exam.id ? 'Saving…' : 'Approve'}
                            </Button>
                            <Button variant="danger" onClick={() => setRejectingId(exam.id)}>Reject</Button>
                          </div>
                          {rejectingId === exam.id && (
                            <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void reject(event, exam); }}>
                              <Field label="Rejection reason (minimum 3 characters)" htmlFor={`reject-reason-${exam.id}`}>
                                <Input id={`reject-reason-${exam.id}`} name="reason" minLength={3} required />
                              </Field>
                              <div className="table-actions flex flex-wrap items-center gap-2">
                                <Button variant="danger" type="submit" disabled={busyId === exam.id}>Confirm reject</Button>
                                <Button variant="secondary" type="button" onClick={() => setRejectingId(null)}>Cancel</Button>
                              </div>
                            </form>
                          )}
                        </>
                      )}
                      {canRegenerate(exam.status) && (
                        <>
                          <div className="table-actions flex flex-wrap items-center gap-2">
                            <Button variant="secondary" onClick={() => openRotation(exam)}>
                              Regenerate code
                            </Button>
                          </div>
                          {rotatingId === exam.id && (
                            <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void regenerate(event, exam); }}>
                              <p className="font-normal text-muted">
                                Regenerating replaces the access code the moment you confirm, so any
                                student still holding the old one cannot start this exam.
                              </p>
                              <Field
                                label={`New expiry (optional — this exam ends ${formatDateTime(exam.end_time)})`}
                                htmlFor={`regenerate-expiry-${exam.id}`}
                              >
                                <Input
                                  id={`regenerate-expiry-${exam.id}`}
                                  type="datetime-local"
                                  value={rotatingExpiry}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setRotatingExpiry(value);
                                    setRotatingProblem(regenerateProblem(value, Date.now(), exam.end_time));
                                  }}
                                />
                              </Field>
                              <p className="font-normal text-muted">
                                Leave it blank to keep the expiry already on this exam.
                              </p>
                              {rotatingProblem !== null && <Alert variant="info">{rotatingProblem}</Alert>}
                              <div className="table-actions flex flex-wrap items-center gap-2">
                                <Button variant="danger" type="submit" disabled={busyId === exam.id}>
                                  {busyId === exam.id ? 'Regenerating…' : 'Confirm regenerate'}
                                </Button>
                                <Button variant="secondary" type="button" onClick={() => setRotatingId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          )}
                          {rotation !== undefined && (
                            <p className="font-normal text-muted">
                              New access code <strong>{rotation.code}</strong>
                              {rotation.detail}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
              );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
