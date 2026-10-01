/* eslint-disable react-hooks/set-state-in-effect -- the exam and its attempts come from the API, and the deadline clock has to tick */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { describeError, EmptyState, formatDateTime, humanise, plural } from '../admin/adminShared';
import type { ExamDetail } from '../doctor/doctorExamTypes';
import {
  LIVE_RENDER_CAP,
  ONLINE_LABELS,
  applyRelease,
  canRelease,
  deadlineState,
  filterAttempts,
  liveCensus,
  onlineState,
  releaseDialogCopy,
  releaseNotice,
  visibleRows,
} from './monitoringModel';
import type { LiveAttempt, LiveResponse, ReleaseResponse } from './monitoringTypes';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'auto_submitted', label: 'Auto submitted' },
];

// Mirrors ExamCompensationPage's BACK_LINKS: the same component serves doctor and
// admin under different routes, so the back link is derived from the signed-in
// role rather than from a prop. A prop-derived back link pointing at the wrong
// exams list is a navigation bug the server cannot catch.
const BACK_LINKS = {
  admin: { to: '/admin/exams', label: 'Back to exams' },
  doctor: { to: '/doctor/exams', label: 'Back to exams' },
} as const;

async function settle<T>(load: Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await load, error: null };
  } catch (caught) {
    return { data: null, error: describeError(caught) };
  }
}

const DEADLINE_LABELS = {
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  ok: '',
  none: '',
} as const;

export function ExamLivePage() {
  const { examId } = useParams();
  const id = examId ?? '';
  const { user } = useAuth();
  const back = user?.role === 'admin' ? BACK_LINKS.admin : BACK_LINKS.doctor;

  const [exam, setExam] = useState<ExamDetail | null>(null);
  // null, not []: a failed request is not the same claim as "this exam has no attempts", and
  // the census below is a sentence about how a cohort is doing.
  const [attempts, setAttempts] = useState<LiveAttempt[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deadlines move with the clock even when the attempt list does not, so this ticks on
  // its own. The attempt data itself does not — the server computes `online` when it
  // answers, and refreshing costs ~900 KB on a full cohort, so that is a manual action.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (id === '') return;
    setLoading(true);
    setActionError(null);
    const [examResult, liveResult] = await Promise.all([
      settle(api.get<{ exam: ExamDetail }>(`/exams/${id}`)),
      settle(api.get<LiveResponse>(`/exams/${id}/live`)),
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
      setLoadedAt(Date.now());
    } else {
      setAttempts(null);
      setAttemptsError(liveResult.error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const census = useMemo(() => liveCensus(attempts), [attempts]);
  const filtered = useMemo(
    () => (attempts === null ? null : filterAttempts(attempts, query, status)),
    [attempts, query, status],
  );
  const shown = useMemo(() => (filtered === null ? null : visibleRows(filtered)), [filtered]);

  async function release(attempt: LiveAttempt) {
    setBusyId(attempt.student_exam_id);
    setActionError(null);
    setNotice(null);
    try {
      const result = await api.post<ReleaseResponse>(
        `/exams/${id}/attempts/${attempt.student_exam_id}/release`,
      );
      // Flipping the flag locally rather than refetching: it is what the route did, and it
      // leaves the row visibly disabled, so the effect of the click is not something the
      // reader has to take on trust.
      setAttempts((current) => (current === null ? null : applyRelease(current, attempt.student_exam_id)));
      setReleasingId(null);
      setNotice(releaseNotice(attempt.student.full_name, result.message));
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Card>
        <p className="muted">
          <Link to={back.to}>{back.label}</Link>
        </p>
        <div className="results-head">
          <div>
            <h2>{exam ? `Live monitoring — ${exam.title}` : 'Live monitoring'}</h2>
            {exam && (
              <p className="page-intro">
                {exam.subject.code} — {exam.subject.name} · open {formatDateTime(exam.start_time)} to{' '}
                {formatDateTime(exam.end_time)}
              </p>
            )}
          </div>
          <div className="row-actions">
            <Button variant="secondary" disabled={loading} onClick={() => { void load(); }}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div>
            <Spinner label="Loading attempts" /> Loading…
          </div>
        ) : loadError ? (
          <Alert>{loadError}</Alert>
        ) : (
          <div className="form-stack">
            {actionError && <Alert>{actionError}</Alert>}
            {notice && <Alert variant="success">{notice}</Alert>}
            {attemptsError && <Alert variant="info">{attemptsError}</Alert>}

            {census === null ? (
              <Alert variant="info">
                The attempt list could not be loaded, so how many students this exam reaches is
                unknown.
              </Alert>
            ) : (
              <>
                <div className="results-stats">
                  <span className="stat">
                    <span className="tally-label">Attempts</span>{' '}
                    <strong className="tally-value">{census.total}</strong>
                  </span>
                  <span className="stat">
                    <span className="tally-label">In progress</span>{' '}
                    <strong className="tally-value">{census.in_progress}</strong>
                  </span>
                  <span className="stat">
                    <span className="tally-label">Submitted</span>{' '}
                    <strong className="tally-value">{census.submitted}</strong>
                  </span>
                  <span className="stat">
                    <span className="tally-label">Auto submitted</span>{' '}
                    <strong className="tally-value">{census.auto_submitted}</strong>
                  </span>
                  <span className="stat">
                    <span className="tally-label">Not started</span>{' '}
                    <strong className="tally-value">{census.not_started}</strong>
                  </span>
                </div>

                <div className="results-toolbar">
                  <Field label="Search" htmlFor="live-search">
                    <span className="search-wrap">
                      <Input
                        id="live-search"
                        value={query}
                        placeholder="Search by name or student code"
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M7 2.5a4.5 4.5 0 1 0 2.6 8.2l2.5 2.5 1-1-2.5-2.5A4.5 4.5 0 0 0 7 2.5Zm0 1.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                  </Field>
                  <Field label="Status" htmlFor="live-status">
                    <Select
                      id="live-status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      {STATUS_FILTERS.map((filter) => (
                        <option key={filter.value} value={filter.value}>
                          {filter.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <p className="muted">
                  A student counts as online only if the server saw a heartbeat from them in the
                  last minute, and that is decided when this page loads — loaded{' '}
                  {loadedAt === null ? 'just now' : `at ${formatDateTime(new Date(loadedAt).toISOString())}`}.
                  Use Refresh to re-check. {releaseDialogCopy()}
                </p>

                {shown === null ? null : shown.total === 0 ? (
                  <EmptyState>
                    {attempts !== null && attempts.length > 0
                      ? 'No attempts match this search or filter.'
                      : 'No attempts have been generated for this exam yet.'}
                  </EmptyState>
                ) : (
                  <>
                    {shown.hidden > 0 && (
                      <Alert variant="info">
                        Showing the first {LIVE_RENDER_CAP} of {shown.total} matching{' '}
                        {plural(shown.total, 'attempts')}. Search or filter to narrow the list.
                      </Alert>
                    )}
                    <Table>
                      <thead>
                        <tr>
                          <th>Sno</th>
                          <th>Student</th>
                          <th>Status</th>
                          <th>Answered</th>
                          <th>Deadline</th>
                          <th>Session</th>
                          <th>Connection</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.rows.map((attempt, index) => {
                          const connection = ONLINE_LABELS[onlineState(attempt)];
                          const deadline = DEADLINE_LABELS[deadlineState(attempt.deadline_at, attempt.status, now)];
                          const releaseGate = canRelease(attempt);
                          const busy = busyId === attempt.student_exam_id;
                          return (
                            <tr key={attempt.student_exam_id}>
                              <td>{index + 1}</td>
                              <td>
                                <div>{attempt.student.full_name}</div>
                                <div className="muted">{attempt.student.student_code ?? '—'}</div>
                              </td>
                              <td>
                                <span className={`status status--${attempt.status}`}>
                                  {humanise(attempt.status)}
                                </span>
                              </td>
                              <td>{attempt.answered_count}</td>
                              <td>
                                <div>{formatDateTime(attempt.deadline_at)}</div>
                                {deadline !== '' && (
                                  <div className="muted">
                                    {deadline === 'Overdue' ? 'Overdue' : 'Due soon'}
                                  </div>
                                )}
                              </td>
                              <td className="muted">{attempt.has_active_session ? 'Active' : 'None'}</td>
                              <td className="muted">{connection}</td>
                              <td>
                                {releasingId === attempt.student_exam_id ? (
                                  <div className="row-actions">
                                    <span className="muted">Release this session?</span>
                                    <Button
                                      variant="danger"
                                      disabled={busy}
                                      title={releaseDialogCopy()}
                                      onClick={() => { void release(attempt); }}
                                    >
                                      {busy ? 'Releasing…' : 'Confirm release'}
                                    </Button>
                                    <Button variant="secondary" onClick={() => setReleasingId(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    disabled={!releaseGate.allowed}
                                    title={releaseGate.allowed ? 'Release this device session' : releaseGate.reason}
                                    onClick={() => {
                                      setReleasingId(attempt.student_exam_id);
                                      setNotice(null);
                                    }}
                                  >
                                    Release
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}