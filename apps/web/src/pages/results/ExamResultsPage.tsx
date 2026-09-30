/* eslint-disable react-hooks/set-state-in-effect -- the exam and its rows come from the API and cannot be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { useAuth } from '../../hooks/useAuth';
import { ApiError, api } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import { describeError, EmptyState, formatDateTime } from '../admin/adminShared';
import {
  buildExportPath,
  exportFileName,
  filterResultRows,
  formatGradeCell,
  pointsValue,
  resultStats,
  statusLabel,
} from './resultsModel';
import type { ExamResultsResponse } from './resultsTypes';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'auto_submitted', label: 'Auto submitted' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'not_started', label: 'Not started' },
];

const BACK_LINKS = {
  admin: { to: '/admin/results', label: 'Back to subject results' },
  doctor: { to: '/doctor/results', label: 'Back to subject results' },
  ta: { to: '/ta/quizzes', label: 'Back to quizzes' },
} as const;

/** There is deliberately no `ta` entry: §9 and FR-18 refuse grade compensation to a TA on every
 *  route, so a TA is not given a control that can only ever answer 403. */
const COMPENSATE_BASE = {
  admin: '/admin/exams',
  doctor: '/doctor/exams',
} as const;

export function ExamResultsPage() {
  const { examId, quizId } = useParams();
  const id = examId ?? quizId ?? '';
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<ExamResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadExam = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<ExamResultsResponse>(`/results/exams/${id}`));
      setError(null);
      setErrorStatus(null);
    } catch (caught) {
      setData(null);
      setError(describeError(caught));
      setErrorStatus(caught instanceof ApiError ? caught.status : null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id !== '') void loadExam();
  }, [id, loadExam]);

  const rows = useMemo(
    () => (data ? filterResultRows(data.results, query, status) : []),
    [data, query, status],
  );
  const stats = useMemo(() => (data ? resultStats(data.results) : null), [data]);

  async function exportExam() {
    if (!data) return;
    const scope = data.exam.type === 'doctor_exam' ? `exam:${data.exam.id}` : `quiz:${data.exam.id}`;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await api.download(buildExportPath(data.exam.subject.id, scope));
      saveBlob(blob, exportFileName(data.exam.subject.code, scope));
    } catch (caught) {
      setExportError(describeError(caught));
    } finally {
      setExporting(false);
    }
  }

  const back = user && user.role !== 'student' ? BACK_LINKS[user.role] : null;
  const compensateBase = user && user.role in COMPENSATE_BASE ? COMPENSATE_BASE[user.role as 'admin' | 'doctor'] : null;
  const isWaiting = errorStatus === 409;

  return (
    <Card>
      {back && (
        <p className="muted">
          <Link to={back.to}>{back.label}</Link>
        </p>
      )}
      <div className="results-head">
        <div>
          <h2>{data ? data.exam.title : 'Exam results'}</h2>
          {data && (
            <p className="page-intro">
              {data.exam.subject.code} — {data.exam.subject.name} · {data.exam.type === 'doctor_exam' ? 'Exam' : 'Quiz'} by{' '}
              {data.exam.owner.full_name} · {formatGradeCell(pointsValue(data.exam.points_per_question))} points per
              question · {formatGradeCell(data.exam.max_grade)} max
            </p>
          )}
          {data && (
            <p className="muted">
              {formatDateTime(data.exam.start_time)} to {formatDateTime(data.exam.end_time)}
            </p>
          )}
        </div>
        {data && (
          <div className="row-actions">
            {/* Compensating is allowed while an exam is still running (§4.5), and this page 409s
                until the exam ends, so results alone would be an unreachable entry point during
                exactly the window it is needed. The exam list carries the same button. */}
            {compensateBase && (
              <Button
                variant="secondary"
                onClick={() => navigate(`${compensateBase}/${data.exam.id}/compensate`)}
              >
                Compensate grades
              </Button>
            )}
            <Button variant="secondary" disabled={exporting} onClick={() => void exportExam()}>
              <span aria-hidden="true" className="button-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 1v9.2M4.8 7.4 8 10.6l3.2-3.2M2.5 12.5h11V15h-11z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {exporting ? 'Exporting…' : 'Export results'}
            </Button>
          </div>
        )}
      </div>

      {exportError && <Alert>{exportError}</Alert>}

      {loading ? (
        <div>
          <Spinner label="Loading results" /> Loading results…
        </div>
      ) : error ? (
        <Alert variant={isWaiting ? 'info' : 'error'}>{error}</Alert>
      ) : (
        data && (
          <div className="form-stack">
            {stats && (
              <div className="results-stats">
                <span className="stat">
                  <span className="tally-label">Students</span>{' '}
                  <strong className="tally-value">{stats.total}</strong>
                </span>
                <span className="stat">
                  <span className="tally-label">Graded</span> <strong className="tally-value">{stats.graded}</strong>
                </span>
                <span className="stat">
                  <span className="tally-label">Submitted</span>{' '}
                  <strong className="tally-value">{stats.submitted}</strong>
                </span>
                <span className="stat">
                  <span className="tally-label">Average</span>{' '}
                  <strong className="tally-value">
                    {stats.average === null ? '—' : formatGradeCell(stats.average)}
                  </strong>
                </span>
              </div>
            )}

            <div className="results-toolbar">
              <Field label="Search" htmlFor="exam-results-search">
                <span className="search-wrap">
                  <Input
                    id="exam-results-search"
                    value={query}
                    placeholder="Search for students here"
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
              <Field label="Status" htmlFor="exam-results-status">
                <Select
                  id="exam-results-status"
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

            {rows.length === 0 ? (
              <EmptyState>
                {data.results.length === 0
                  ? 'No students are eligible for this exam yet.'
                  : 'No students match this search.'}
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Sno</th>
                    <th>Student</th>
                    <th>Section</th>
                    <th>Status</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.student_id}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="question-text">{row.student_name}</div>
                        <span className="muted">{row.student_code ?? '—'}</span>
                      </td>
                      <td>
                        {row.section ? (
                          <>
                            <div>{row.section.name}</div>
                            <span className="muted">{row.section.ta.full_name}</span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`status status--${row.status}`}>{statusLabel(row.status)}</span>
                      </td>
                      <td className="grade-cell">{formatGradeCell(row.grade)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            <p className="muted">
              Grades are shown exactly as recorded. Points per question is the exam&apos;s single scoring value.
            </p>
          </div>
        )
      )}
    </Card>
  );
}
