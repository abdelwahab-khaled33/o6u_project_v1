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
  describeError,
  EmptyState,
  formatDateTime,
  formValue,
  humanise,
  type AdminExam,
} from './adminShared';

type ExamTypeFilter = 'doctor_exam' | 'ta_quiz' | 'all';

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

  return (
    <Card>
      <h2>Exams</h2>
      <p className="page-intro">
        Doctor-authored exams need approval; TA quizzes do not and appear once a TA creates them. Rejection reasons must contain at least 3 characters after trimming.
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <div className="form-stack">
        <div className="filter-bar">
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
              {exams.map((exam) => (
                <tr key={exam.id}>
                  <td>{exam.title}</td>
                  <td>{humanise(exam.type)}</td>
                  <td>{exam.subject.code} — {exam.subject.name}</td>
                  <td>{exam.owner.full_name}</td>
                  <td>{humanise(exam.status)}</td>
                  <td>{formatDateTime(exam.start_time)}</td>
                  <td>{formatDateTime(exam.end_time)}</td>
                  <td>
                    <div className="row-actions">
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
                    </div>
                    {exam.status === 'pending_approval' && (
                      <>
                        <div className="row-actions">
                          <Button disabled={busyId === exam.id} onClick={() => { void approve(exam); }}>
                            {busyId === exam.id ? 'Saving…' : 'Approve'}
                          </Button>
                          <Button variant="danger" onClick={() => setRejectingId(exam.id)}>Reject</Button>
                        </div>
                        {rejectingId === exam.id && (
                          <form className="form-stack" onSubmit={(event) => { void reject(event, exam); }}>
                            <Field label="Rejection reason (minimum 3 characters)" htmlFor={`reject-reason-${exam.id}`}>
                              <Input id={`reject-reason-${exam.id}`} name="reason" minLength={3} required />
                            </Field>
                            <div className="row-actions">
                              <Button variant="danger" type="submit" disabled={busyId === exam.id}>Confirm reject</Button>
                              <Button variant="secondary" type="button" onClick={() => setRejectingId(null)}>Cancel</Button>
                            </div>
                          </form>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
