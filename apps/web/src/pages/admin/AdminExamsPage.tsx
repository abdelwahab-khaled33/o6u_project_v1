/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
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
  type AdminExam,
} from './adminShared';

type ExamTypeFilter = 'doctor_exam' | 'ta_quiz';

type ExamStatusFilter = 'pending_approval' | 'approved' | 'rejected' | '';

type ShownCode = {
  code: string;
  expiresAt: string | null;
  fresh: boolean;
};

function formatWindow(startTime: string, endTime: string): string {
  const start = formatDateTime(startTime);
  const end = formatDateTime(endTime);
  const startDay = start.split(', ')[0];
  const endDay = end.split(', ')[0];
  if (startDay === endDay) {
    const endClock = end.split(', ')[1] ?? end;
    return `${start} – ${endClock}`;
  }
  return `${start} – ${end}`;
}

const TYPE_SEGMENTS: Array<{ value: ExamTypeFilter; label: string }> = [
  { value: 'doctor_exam', label: 'Doctor exams' },
  { value: 'ta_quiz', label: 'TA quizzes' },
];

const STATUS_SEGMENTS: Array<{ value: ExamStatusFilter; label: string }> = [
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

function Segment<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-[14px] border border-[#dfe5f0] bg-white p-1.5 shadow-[0_4px_14px_rgb(36_52_80/7%)]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onPick(option.value)}
          className={`rounded-[10px] px-5 py-2.5 font-semibold ${
            option.value === value ? 'bg-primary text-white' : 'text-primary-dark hover:bg-[#eef3fb]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_PILL_LABEL: Record<string, string> = {
  pending_approval: '⏳ Pending approval',
  approved: '✓ Approved',
  rejected: '✕ Rejected',
};

/**
 * The route returns the whole EXAM_DETAIL_SELECT object under `exam`. Only the expiry is read
 * here, so only the expiry is typed: declaring the full projection would make a rename in the
 * server's select look like a change this screen has to make.
 */
type RegenerateResponse = {
  access_code: string;
  exam: { access_code_expires_at: string | null };
};

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
  // Codes fetched back from the server survive a logout: unlike this page state, the ciphertext
  // lives in the database and decrypts on demand. `fresh` marks a code rotated in this session,
  // which is the only case adding "replaces the old code". A null entry means the server has no
  // code, so the strip says so instead of spinning forever.
  const [codes, setCodes] = useState<Record<string, ShownCode | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [moreId, setMoreId] = useState<string | null>(null);
  // The approval itself generates the code, but an approved exam leaves the pending list on
  // refetch — so the fresh code is kept here and shown above the list instead of on the card.
  const [approvedCode, setApprovedCode] = useState<{ examId: string; title: string; notice: RegenerateNotice } | null>(null);

  const loadExams = useCallback(async () => {
    try {
      const result = await api.get<{ exams: AdminExam[] }>('/admin/exams');
      setExams(result.exams);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadExams(); }, [loadExams]);

  const typedExams = useMemo(
    () => exams.filter((exam) => exam.type === typeFilter),
    [exams, typeFilter],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { pending_approval: 0, approved: 0, rejected: 0 };
    for (const exam of typedExams) {
      if (exam.status in counts) counts[exam.status] = (counts[exam.status] ?? 0) + 1;
    }
    return counts;
  }, [typedExams]);
  const visibleExams = useMemo(
    () => (status === '' ? typedExams : typedExams.filter((exam) => exam.status === status)),
    [typedExams, status],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const missing = exams.filter((exam) => canRegenerate(exam.status) && codes[exam.id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (exam) => {
      try {
        const result = await api.get<{ access_code: string; access_code_expires_at: string | null }>(
          `/exams/${exam.id}/access-code`,
        );
        if (cancelled) return;
        setCodes((previous) => {
          if (previous[exam.id] !== undefined) return previous;
          return {
            ...previous,
            [exam.id]: { code: result.access_code, expiresAt: result.access_code_expires_at, fresh: false },
          };
        });
      } catch {
        if (cancelled) return;
        setCodes((previous) => (previous[exam.id] === undefined ? { ...previous, [exam.id]: null } : previous));
      }
    }));
    return () => { cancelled = true; };
  }, [exams, codes]);

  async function approve(exam: AdminExam, now: number) {
    setBusyId(exam.id);
    setError(null);
    setNotice(null);
    setApprovedCode(null);
    try {
      await api.post(`/admin/exams/${exam.id}/approve`);
      setNotice(`Approved ${exam.title}.`);
      await loadExams();
      try {
        const { code, expiresAt } = await fetchCode(exam);
        setApprovedCode({
          examId: exam.id,
          title: exam.title,
          notice: regenerateNotice(code, expiresAt, formatDateTime, now),
        });
        setCodes((previous) => ({ ...previous, [exam.id]: { code, expiresAt, fresh: true } }));
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

  async function fetchCode(exam: AdminExam): Promise<{ code: string; expiresAt: string | null }> {
    const result = await api.get<{ access_code: string; access_code_expires_at: string | null }>(
      `/exams/${exam.id}/access-code`,
    );
    return { code: result.access_code, expiresAt: result.access_code_expires_at };
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
      setCodes((previous) => ({
        ...previous,
        [exam.id]: { code: result.access_code, expiresAt: result.exam.access_code_expires_at, fresh: true },
      }));
      setRotatingId(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h2>Exams</h2>
      <p className="font-normal text-muted">
        Doctor-authored exams need approval; TA quizzes appear as soon as a TA creates them.
        Rejection reasons need at least 3 characters.
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
        <div className="flex flex-wrap gap-3">
          <Segment
            label="Exam type"
            options={TYPE_SEGMENTS}
            value={typeFilter}
            onPick={(next) => {
              setApprovedCode(null);
              setMoreId(null);
              setTypeFilter(next);
            }}
          />
          <Segment
            label="Exam status"
            options={STATUS_SEGMENTS.map((option) =>
              option.value === 'pending_approval'
                ? { ...option, label: `Pending · ${statusCounts.pending_approval ?? 0}` }
                : option,
            )}
            value={status}
            onPick={(next) => {
              setApprovedCode(null);
              setMoreId(null);
              setStatus(next);
            }}
          />
        </div>
        {loading ? (
          <div><Spinner label="Loading exams" /> Loading exams…</div>
        ) : visibleExams.length === 0 ? (
          <EmptyState>No exams found for this type and status.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {visibleExams.map((exam) => {
              const entry = codes[exam.id];
              const pending = exam.status === 'pending_approval';
              return (
                <section
                  key={exam.id}
                  className="grid gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <strong className="text-[1.05rem] text-primary-dark">{exam.title}</strong>
                      <span className={`${STATUS_PILL} ${statusTone(exam.status)}`}>
                        {STATUS_PILL_LABEL[exam.status] ?? exam.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={() => navigate(`/admin/exams/${exam.id}/review`)}>
                        Review
                      </Button>
                      {exam.status === 'pending_approval' ? (
                        <>
                          <Button variant="dangerOutline" onClick={() => setRejectingId(exam.id)}>Reject</Button>
                          <Button disabled={busyId === exam.id} onClick={() => { void approve(exam, Date.now()); }}>
                            {busyId === exam.id ? 'Saving…' : 'Approve'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="secondary" onClick={() => navigate(`/admin/results/${exam.id}`)}>
                            Results
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/admin/exams/${exam.id}/live`)}
                          >
                            Monitor
                          </Button>
                        </>
                      )}
                      {!pending && (
                      <span className="relative">
                        <Button
                          variant="secondary"
                          aria-haspopup="menu"
                          aria-expanded={moreId === exam.id}
                          onClick={() => setMoreId(moreId === exam.id ? null : exam.id)}
                        >
                          More ▾
                        </Button>
                        {moreId === exam.id && (
                          <>
                            <button
                              type="button"
                              aria-label="Close menu"
                              onClick={() => setMoreId(null)}
                              className="fixed inset-0 z-30 cursor-default border-0 bg-transparent p-0"
                            />
                            <span
                              role="menu"
                              className="absolute end-0 top-[calc(100%+6px)] z-40 grid min-w-[180px] gap-1 rounded-[10px] border border-[#dfe5f0] bg-white p-1.5 shadow-[0_12px_32px_rgb(36_52_80/15%)]"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setMoreId(null); void navigate(`/admin/exams/${exam.id}/compensate`); }}
                                className="rounded-[7px] px-3 py-2 text-left font-semibold text-primary-dark hover:bg-[#eef3fb]"
                              >
                                Compensate
                              </button>
                            </span>
                          </>
                        )}
                      </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[0.9rem]">
                    <span className="font-normal text-muted">{exam.subject.code} · {exam.subject.name}</span>
                    <span>Owner: <strong>{exam.owner.full_name}</strong></span>
                    <span className="font-normal text-muted">{formatWindow(exam.start_time, exam.end_time)}</span>
                  </div>
                  {exam.status === 'pending_approval' && rejectingId === exam.id && (
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
                  {canRegenerate(exam.status) && (
                    <div className="grid gap-2 rounded-xl bg-[#eef3fb] px-4 py-3">
                      {entry === undefined ? (
                        <p className="text-[0.85rem] font-normal text-muted">Loading access code…</p>
                      ) : entry === null ? (
                        <p className="text-[0.85rem] font-normal text-muted">No access code for this exam yet.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="text-muted">Access code</span>
                            <strong className="font-mono text-[1.3rem] font-extrabold tracking-[0.2em] text-primary-dark">
                              {entry.code}
                            </strong>
                            <Button variant="secondary" onClick={() => { void copyCode(exam.id, entry.code); }}>
                              {copiedId === exam.id ? 'Copied' : 'Copy'}
                            </Button>
                            <Button variant="secondary" onClick={() => openRotation(exam)}>
                              Regenerate
                            </Button>
                          </div>
                          <p className="text-[0.85rem] font-normal text-muted">
                            {entry.expiresAt ? `Valid until ${formatDateTime(entry.expiresAt)}` : 'No expiry recorded.'}
                            {entry.fresh ? ' · replaces the old code' : ''}
                          </p>
                        </>
                      )}
                    </div>
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
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
