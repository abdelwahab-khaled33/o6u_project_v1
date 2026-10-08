/* eslint-disable react-hooks/set-state-in-effect -- the exam list and the start flow both come from the API and cannot be derived during render */
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { STATUS_PILL } from '../../lib/statusTone';
import { EmptyState, formatDateTime, messageFrom } from '../admin/adminShared';
import { formatGrade } from '../doctor/DoctorQuestionForm';
import { StudentExamRunner, type FinishReason } from './StudentExamRunner';
import {
  accessCodeInputProblem,
  accessCodeProblem,
  examRunProblem,
  normaliseAccessCode,
  toStartResponse,
  toStudentExam,
  type StartResponse,
  type StudentAttempt,
  type StudentExamSummary,
  type StudentQuestion,
} from './studentExamModel';

type Phase = 'list' | 'running' | 'done';

type RunningExam = {
  exam: StudentExamSummary;
  attempt: StudentAttempt;
  questions: StudentQuestion[];
  serverNow: string;
};

export function StudentExamsPage() {
  const [phase, setPhase] = useState<Phase>('list');
  const [finishReason, setFinishReason] = useState<FinishReason | null>(null);
  const [running, setRunning] = useState<RunningExam | null>(null);

  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [startErrors, setStartErrors] = useState<Record<string, string | null>>({});
  const [startBusy, setStartBusy] = useState<string | null>(null);
  const [activeExam, setActiveExam] = useState<StudentExamSummary | null>(null);
  const [modalCode, setModalCode] = useState('');

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ exams: unknown[] }>('/student/exams');
      setExams((result.exams ?? []).map(toStudentExam));
      setListError(null);
    } catch (caught) {
      setListError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  useEffect(() => {
    if (!activeExam) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveExam(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeExam]);

  function openAttend(exam: StudentExamSummary) {
    setActiveExam(exam);
    setModalCode('');
    setStartErrors((current) => ({ ...current, [exam.id]: null }));
  }

  async function startExam(exam: StudentExamSummary, code: string | null) {
    if (startBusy === exam.id) return;
    if (code != null && accessCodeInputProblem(code) !== null) return;
    setStartBusy(exam.id);
    setStartErrors((current) => ({ ...current, [exam.id]: null }));
    try {
      // A resume sends no access code: the server only validates it in the not_started branch.
      const result = await api.post<StartResponse>(
        `/student/exams/${exam.id}/start`,
        code == null ? undefined : { access_code: code },
      );
      const started = toStartResponse(result);
      setRunning({
        exam,
        attempt: started.student_exam,
        questions: started.questions,
        serverNow: started.server_now,
      });
      setPhase('running');
    } catch (caught) {
      const problem = accessCodeProblem(caught) ?? examRunProblem(caught) ?? messageFrom(caught);
      setStartErrors((current) => ({ ...current, [exam.id]: problem }));
    } finally {
      setStartBusy(null);
    }
  }

  function onFinished(reason: FinishReason) {
    setFinishReason(reason);
    setPhase('done');
  }

  function onAbandon(message: string | null) {
    setRunning(null);
    setListError(message ?? 'Your exam session was interrupted.');
    setPhase('list');
    void loadExams();
  }

  async function backToList() {
    setPhase('list');
    setRunning(null);
    setFinishReason(null);
    await loadExams();
  }

  if (phase === 'running' && running) {
    return (
      <StudentExamRunner
        exam={running.exam}
        attempt={running.attempt}
        questions={running.questions}
        serverNow={running.serverNow}
        onFinished={onFinished}
        onAbandon={onAbandon}
      />
    );
  }

  if (phase === 'done' && running) {
    return (
      <Card className="mt-5">
        <h2>{running.exam.title} — finished</h2>
        <div className="mt-5 grid gap-[18px]">
          {finishReason === 'submitted' ? (
            <Alert variant="success">
              You have submitted your exam. Your answers are with your instructor now.
            </Alert>
          ) : (
            <Alert variant="info">
              Your exam has been submitted. If time ran out while you were still working, your saved
              answers were sent automatically.
            </Alert>
          )}
          <p className="font-normal text-muted">
            You will not see your answers or your grade on this platform again. If anything still needs your
            attention, your instructor will reach you directly.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => { void backToList(); }}>Back to my exams</Button>
          </div>
        </div>
      </Card>
    );
  }

  const modalProblem = accessCodeInputProblem(modalCode);

  return (
    <div>
      <h2>My exams</h2>
      <p className="font-normal text-muted">
        Once you start, the clock cannot be paused. When time runs out, your saved answers are
        submitted automatically.
      </p>
      {listError && <Alert>{listError}</Alert>}
      <div className="mt-5 grid gap-[18px]">
        {loading ? (
          <div><Spinner label="Loading your exams" /> Loading your exams…</div>
        ) : exams.length === 0 ? (
          <EmptyState>
            You have no exams open right now. When an exam or quiz you are registered for opens, it appears
            here.
          </EmptyState>
        ) : (
          <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
            {exams.map((exam) => {
              const inProgress = exam.status === 'in_progress';
              return (
                <article
                  key={exam.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[#dfe5f0] bg-white p-5 shadow-[0_4px_14px_rgb(36_52_80/7%)] transition-shadow hover:shadow-[0_12px_32px_rgb(36_52_80/12%)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`${STATUS_PILL} border-[#dfe5f0] bg-[#edf0f6] text-muted`}>
                      {exam.type === 'ta_quiz' ? 'Quiz' : 'Exam'}
                    </span>
                    {inProgress ? (
                      <span className={`${STATUS_PILL} border-[#f2c79a] bg-[#fff5ec] text-[#9a4c08]`}>
                        In progress
                      </span>
                    ) : (
                      <span className={`${STATUS_PILL} border-[#a8d7bd] bg-[#effaf3] text-[#147a47]`}>
                        ● Open now
                      </span>
                    )}
                  </div>
                  <h3 className="text-[1.15rem] font-bold leading-snug text-primary-dark [overflow-wrap:anywhere]">
                    {exam.title}
                  </h3>
                  <p className="text-[0.85rem] font-normal text-muted">
                    {exam.subject.code} · {exam.subject.name}
                  </p>
                  <dl className="grid grid-cols-3 gap-3 rounded-xl bg-[#edf0f6] px-4 py-3 text-center">
                    <div>
                      <dt className="text-[0.72rem] font-bold uppercase tracking-[0.05em] text-muted">Duration</dt>
                      <dd className="font-extrabold tabular-nums text-primary-dark">{exam.duration_minutes} min</dd>
                    </div>
                    <div>
                      <dt className="text-[0.72rem] font-bold uppercase tracking-[0.05em] text-muted">Points</dt>
                      <dd className="font-extrabold tabular-nums text-primary-dark">
                        {formatGrade(exam.points_per_question)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[0.72rem] font-bold uppercase tracking-[0.05em] text-muted">Closes</dt>
                      <dd className="font-extrabold tabular-nums text-primary-dark">
                        {formatDateTime(exam.end_time)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto">
                    {inProgress ? (
                      <>
                        <p className="mb-3 font-normal text-muted">
                          You already started this exam. Your answers are saved; resume when you are ready.
                        </p>
                        <Button
                          className="w-full"
                          disabled={startBusy === exam.id}
                          onClick={() => { void startExam(exam, null); }}
                        >
                          {startBusy === exam.id ? 'Opening…' : 'Resume'}
                        </Button>
                      </>
                    ) : (
                      <Button className="w-full" onClick={() => openAttend(exam)}>
                        Attend exam
                      </Button>
                    )}
                    {startErrors[exam.id] && !activeExam && <Alert>{startErrors[exam.id]}</Alert>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {activeExam && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-primary-ink/60 p-4 backdrop-blur-sm"
          onClick={() => setActiveExam(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="attend-exam-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[460px] rounded-2xl border border-[#dfe5f0] border-t-[5px] border-t-accent bg-white p-6 shadow-[0_12px_32px_rgb(36_52_80/20%)]"
          >
            <h2 id="attend-exam-title">{activeExam.title}</h2>
            <p className="mt-1 font-normal text-muted">
              {activeExam.subject.code} — {activeExam.subject.name} ·{' '}
              {activeExam.type === 'ta_quiz' ? 'Quiz' : 'Exam'} · {activeExam.duration_minutes} min ·{' '}
              {formatGrade(activeExam.points_per_question)} points per question
            </p>
            <p className="mt-2 font-normal text-muted">
              {formatDateTime(activeExam.start_time)} to {formatDateTime(activeExam.end_time)}
            </p>
            <form
              className="mt-5 grid gap-[18px]"
              onSubmit={(event) => {
                event.preventDefault();
                void startExam(activeExam, modalCode);
              }}
            >
              <div className="grid gap-[7px] text-[0.94rem] font-semibold text-[#1f2430]">
                <label htmlFor="attend-access-code">Access code</label>
                <Input
                  id="attend-access-code"
                  className="text-center font-mono uppercase tracking-[0.2em]"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={6}
                  placeholder="••••••"
                  value={modalCode}
                  autoFocus
                  onChange={(event) => {
                    setModalCode(normaliseAccessCode(event.target.value));
                    setStartErrors((current) => ({ ...current, [activeExam.id]: null }));
                  }}
                />
              </div>
              {modalProblem != null && modalCode !== '' ? (
                <p className="font-normal text-muted">{modalProblem}</p>
              ) : (
                <p className="font-normal text-muted">
                  Your supervisor announces the 6-character access code when this exam opens.
                </p>
              )}
              {startErrors[activeExam.id] && <Alert>{startErrors[activeExam.id]}</Alert>}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setActiveExam(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={startBusy === activeExam.id || modalProblem !== null}
                >
                  {startBusy === activeExam.id ? 'Starting…' : 'Confirm and start'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}