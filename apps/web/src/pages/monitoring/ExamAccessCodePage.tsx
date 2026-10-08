/* eslint-disable react-hooks/set-state-in-effect -- the exam and its access code come from the API and cannot be derived during render */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError, api } from '../../lib/api';
import { describeError, formatDateTime, humanise } from '../admin/adminShared';
import type { ExamDetail } from '../doctor/doctorExamTypes';
import { accessCodeView, codeExpiryText } from './monitoringModel';
import type { AccessCodeResponse, RequestFailure } from './monitoringTypes';

/** An ApiError carries the status; anything else (a dead network) has no response to report. */
function toFailure(caught: unknown): RequestFailure {
  if (caught instanceof ApiError) return { status: caught.status, message: caught.message };
  return { status: null, message: describeError(caught) };
}

async function settle<T>(load: Promise<T>): Promise<{ data: T | null; failure: RequestFailure | null }> {
  try {
    return { data: await load, failure: null };
  } catch (caught) {
    return { data: null, failure: toFailure(caught) };
  }
}

export function ExamAccessCodePage() {
  const { examId } = useParams();
  const id = examId ?? '';

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [code, setCode] = useState<AccessCodeResponse | null>(null);
  const [codeFailure, setCodeFailure] = useState<RequestFailure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Set when the load resolves, not during render: comparing the expiry to the clock is
  // what decides whether the page says "Valid until" or "Expired", and Date.now() in a
  // render body is an impure read.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    if (id === '') return;
    setLoading(true);
    const [examResult, codeResult] = await Promise.all([
      // GET /exams/:id answers { exam }, not a bare exam.
      settle(api.get<{ exam: ExamDetail }>(`/exams/${id}`)),
      // The only response in the platform that carries the plaintext. Every other exam
      // response is built from EXAM_DETAIL_SELECT, which omits the secret columns.
      settle(api.get<AccessCodeResponse>(`/exams/${id}/access-code`)),
    ]);

    if (examResult.data) {
      setExam(examResult.data.exam);
      setLoadError(null);
    } else {
      setExam(null);
      setLoadError(examResult.failure?.message ?? 'The exam could not be loaded.');
    }

    // The exam load is the fatal one: without a status there is no way to phrase any of
    // the answers below, and a code with no title is not an answer anybody can act on.
    setCode(codeResult.data);
    setCodeFailure(codeResult.failure);
    setNow(Date.now());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = accessCodeView({ status: exam?.status ?? null, code, failure: codeFailure });

  return (
    <div>
      <Card>
        <p className="font-normal text-muted">
          <Link to="/doctor/exams">Back to exams</Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
          <div>
            <h2>{exam ? `Access code — ${exam.title}` : 'Access code'}</h2>
            {exam && (
              <p className="font-normal text-muted">
                {exam.subject.code} — {exam.subject.name} · {exam.type === 'doctor_exam' ? 'Exam' : 'Quiz'} ·{' '}
                {humanise(exam.status)} · open {formatDateTime(exam.start_time)} to{' '}
                {formatDateTime(exam.end_time)}
              </p>
            )}
          </div>
        </div>

        {loading || view.kind === 'loading' ? (
          <div>
            <Spinner label="Loading access code" /> Loading…
          </div>
        ) : loadError ? (
          <Alert>{loadError}</Alert>
        ) : (
          <div className="mt-5 grid gap-[18px]">
            {view.kind === 'code' && (
              <>
                <p>
                  Access code <strong>{view.code}</strong>
                </p>
                <p className="font-normal text-muted">{codeExpiryText(view.expiresAt, now, formatDateTime)}</p>
                <p className="font-normal text-muted">
                  Students type this to start the exam. It is shown here and nowhere else, and this
                  page only fetches it when you open it.
                </p>
              </>
            )}

            {view.kind === 'no-code' && (
              <Alert variant="info">
                {view.message}
                {view.hint !== null && <> {view.hint}</>}
              </Alert>
            )}

            {view.kind === 'error' && <Alert>{view.message}</Alert>}
          </div>
        )}
      </Card>
    </div>
  );
}