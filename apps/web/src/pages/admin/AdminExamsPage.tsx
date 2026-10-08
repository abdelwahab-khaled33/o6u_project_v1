/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { STATUS_PILL, statusTone } from '../../lib/statusTone';
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

function AccessCodeBox({
  label,
  notice,
  copied,
  onCopy,
}: {
  label: string;
  notice: RegenerateNotice;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border-2 border-primary bg-[#eef4ff] p-4">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.05em] text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <strong className="font-mono text-[1.75rem] font-extrabold tracking-[0.25em] text-primary-dark">
          {notice.code}
        </strong>
        <Button variant="secondary" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="font-normal text-muted">
        {notice.detail.replace(/^\.\s*/, '')}
      </p>
    </div>
  );
}

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
  // Codes fetched back from the server survive a logout: unlike `rotated`, which lives only
  // in this page's state, the ciphertext lives in the database and decrypts on demand.
  const [revealed, setRevealed] = useState<Record<string, RegenerateNotice>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // The approval itself generates the code, but an approved exam leaves the pending list on
  // refetch — so the fresh code is kept here and shown above the list instead of on the card.
  const [approvedCode, setApprovedCode] = useState<{ examId: string; title: string; notice: RegenerateNotice } | null>(null);

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
    setApprovedCode(null);
    try {
      await api.post(`/admin/exams/${exam.id}/approve`);
      setNotice(`Approved ${exam.title}.`);
      await loadExams();
      try {
        const fresh = await fetchCodeNotice(exam);
        setApprovedCode({ examId: exam.id, title: exam.title, notice: fresh });
      } catch (caught) {
        setError(describeError(caught));
      }
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

  async function fetchCodeNotice(exam: AdminExam): Promise<RegenerateNotice> {
    const result = await api.get<{ access_code: string; access_code_expires_at: string | null }>(
      `/exams/${exam.id}/access-code`,
    );
    return regenerateNotice(result.access_code, result.access_code_expires_at, formatDateTime, Date.now());
  }

  async function showCode(exam: AdminExam) {
    setBusyId(exam.id);
    setError(null);
    try {
      const notice = await fetchCodeNotice(exam);
      setRevealed((previous) => ({ ...previous, [exam.id]: notice }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function copyCode(examId: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(examId);
      window.setTimeout(() => {
        setCopiedId((current) => (current === examId ? null : current));
      }, 2000);
    } catch {
      setCopiedId(null);
    }
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
      {approvedCode !== null && (
        <div className="grid gap-2">
          <p className="font-semibold text-primary-dark">
            {approvedCode.title} is approved — announce this code in the lab:
          </p>
          <AccessCodeBox
            label="New access code"
            notice={approvedCode.notice}
            copied={copiedId === approvedCode.examId}
            onCopy={() => { void copyCode(approvedCode.examId, approvedCode.notice.code); }}
          />
        </div>
      )}
      <div className="mt-5 grid gap-[18px]">
        <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
          <Field label="Type" htmlFor="exam-type">
            <Select id="exam-type" value={typeFilter} onChange={(event) => { setLoading(true); setApprovedCode(null); setTypeFilter(event.target.value as ExamTypeFilter); }}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="exam-status">
            <Select id="exam-status" value={status} onChange={(event) => { setLoading(true); setApprovedCode(null); setStatus(event.target.value); }}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </div>
        {loading ? (
          <div><Spinner label="Loading exams" /> Loading exams…</div>
        ) : exams.length === 0 ? (
          <EmptyState>No exams found for this type and status.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {exams.map((exam) => {
              // Read once: TypeScript cannot narrow a Record lookup keyed by a property path,
              // so reaching for rotated[exam.id] again in the JSX would be two unchecked reads.
              const rotation = rotated[exam.id];
              const shown = revealed[exam.id];
              const codeNotice = rotation ?? shown;
              const topBorder =
                exam.status === 'approved'
                  ? 'border-t-[#2e9e5b]'
                  : exam.status === 'rejected'
                    ? 'border-t-[#b42318]'
                    : 'border-t-accent';
              return (
                <section
                  key={exam.id}
                  className={`grid gap-3 rounded-xl border border-[#dfe5f0] border-t-4 ${topBorder} bg-white p-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <strong className="text-[1.05rem] text-primary-dark">{exam.title}</strong>
                    <span className={`${STATUS_PILL} ${statusTone(exam.status)}`}>{humanise(exam.status)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[0.9rem]">
                    <span className="font-normal text-muted">{exam.subject.code} — {exam.subject.name}</span>
                    <span>Owner: <strong>{exam.owner.full_name}</strong> <span className="font-normal text-muted">({humanise(exam.type)})</span></span>
                    <span className="font-normal text-muted">{formatDateTime(exam.start_time)} – {formatDateTime(exam.end_time)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                    {canRegenerate(exam.status) && (
                      <Button variant="secondary" onClick={() => openRotation(exam)}>
                        Regenerate code
                      </Button>
                    )}
                    {canRegenerate(exam.status) && codeNotice === undefined && (
                      <Button
                        variant="secondary"
                        disabled={busyId === exam.id}
                        onClick={() => { void showCode(exam); }}
                      >
                        {busyId === exam.id ? 'Loading…' : 'Show code'}
                      </Button>
                    )}
                  </div>
                  {exam.status === 'pending_approval' && (
                    <>
                      <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f6] pt-3">
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
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="danger" type="submit" disabled={busyId === exam.id}>Confirm reject</Button>
                            <Button variant="secondary" type="button" onClick={() => setRejectingId(null)}>Cancel</Button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                  {canRegenerate(exam.status) && rotatingId === exam.id && (
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="danger" type="submit" disabled={busyId === exam.id}>
                          {busyId === exam.id ? 'Regenerating…' : 'Confirm regenerate'}
                        </Button>
                        <Button variant="secondary" type="button" onClick={() => setRotatingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                  {codeNotice !== undefined && (
                    <AccessCodeBox
                      label={rotation !== undefined ? 'New access code' : 'Current access code'}
                      notice={codeNotice}
                      copied={copiedId === exam.id}
                      onCopy={() => { void copyCode(exam.id, codeNotice.code); }}
                    />
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
