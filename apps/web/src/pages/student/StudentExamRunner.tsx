import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { useExamTopbar } from '../../hooks/examTopbar';
import { messageFrom } from '../admin/adminShared';
import {
  RUNNER_PAGE_SIZE,
  answerChoices,
  clampPage,
  clockOffsetMs,
  examRunProblem,
  flagProblem,
  formatCountdown,
  isTimeUp,
  pageOfIndex,
  progressSummary,
  remainingMs,
  submitBlockedNotice,
  submitConfirmCopy,
  totalPages,
  wasAutoSubmitted,
  type StudentAttempt,
  type StudentExamSummary,
  type StudentQuestion,
  type UnansweredNotice,
} from './studentExamModel';

const TICK_MS = 1000;
const HEARTBEAT_MS = 30_000;
const SHORT_CLOCK_MS = 5 * 60 * 1000;

export type FinishReason = 'submitted' | 'auto_submitted';

type SaveState = { phase: 'saving' | 'saved'; at: number } | null;

type RunnerProps = {
  exam: StudentExamSummary;
  attempt: StudentAttempt;
  questions: StudentQuestion[];
  serverNow: string;
  onFinished: (reason: FinishReason) => void;
  onAbandon: (message: string | null) => void;
};

export function StudentExamRunner({ exam, attempt, questions: initialQuestions, serverNow, onFinished, onAbandon }: RunnerProps) {
  const [questions, setQuestions] = useState<StudentQuestion[]>(initialQuestions);
  const [offsetMs, setOffsetMs] = useState(() => clockOffsetMs(serverNow, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string | undefined>>({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unanswered, setUnanswered] = useState<UnansweredNotice | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const submittingRef = useRef(false);
  const deadlineHandledRef = useRef(false);
  const questionRefs = useRef(new Map<string, HTMLElement>());
  const dialogRef = useRef<HTMLDivElement>(null);

  const remaining = remainingMs(attempt.deadline_at, offsetMs, now);
  const expired = attempt.deadline_at != null && isTimeUp(remaining);
  const progress = useMemo(() => progressSummary(questions), [questions]);
  const pageTotal = totalPages(questions.length, RUNNER_PAGE_SIZE);
  const safePage = clampPage(page, pageTotal);
  const pageStart = safePage * RUNNER_PAGE_SIZE;
  const visibleQuestions = questions.slice(pageStart, pageStart + RUNNER_PAGE_SIZE);

  const { setTop } = useExamTopbar();
  const pendingSave = Object.values(saves).some((entry) => entry?.phase === 'saving');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // FR-31: the timer cannot be paused by the student, so nothing here can stop it. The only thing the
  // page can do at the deadline is ask the server to finalise, and the server decides either way.
  useEffect(() => {
    if (!expired || deadlineHandledRef.current) return;
    deadlineHandledRef.current = true;
    setSessionNotice('Your time is up. Submitting your exam…');
    void submitAttempt('deadline');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot at the deadline, guarded by the ref
  }, [expired]);

  useEffect(() => {
    if (expired || submitting) return;
    const timer = setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- heartbeat cadence must not restart on every render
  }, [expired, submitting]);

  useEffect(() => {
    if (!confirming) return;
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirming(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  useEffect(() => {
    function warnOnLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnOnLeave);
    return () => window.removeEventListener('beforeunload', warnOnLeave);
  }, []);

  const sendHeartbeat = useCallback(async () => {
    try {
      const result = await api.post<{ ok: boolean; server_now: string; status: string }>(
        `/student/exams/${exam.id}/heartbeat`,
      );
      setOffsetMs(clockOffsetMs(result.server_now, Date.now()));
      if (result.status === 'auto_submitted') onFinished('auto_submitted');
    } catch (caught) {
      if (wasAutoSubmitted(caught)) {
        onFinished('auto_submitted');
        return;
      }
      const problem = examRunProblem(caught);
      if (problem) {
        setSessionNotice(problem);
        onAbandon(problem);
      }
    }
  }, [exam.id, onAbandon, onFinished]);

  async function submitAttempt(reason: 'manual' | 'deadline') {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post(`/student/exams/${exam.id}/submit`);
      onFinished('submitted');
      return;
    } catch (caught) {
      // The server answers 409 with the exact number of questions still unanswered. That number is the
      // only authority on whether an answer reached the database, so it is what the page shows.
      const blocked = submitBlockedNotice(caught);
      if (blocked) {
        setUnanswered(blocked);
        setConfirming(false);
        focusFirstUnanswered();
        return;
      }
      if (wasAutoSubmitted(caught)) {
        onFinished('auto_submitted');
        return;
      }
      if (reason === 'deadline') {
        const problem = examRunProblem(caught);
        if (problem) {
          setSessionNotice(problem);
          onAbandon(problem);
          return;
        }
      }
      setSubmitError(examRunProblem(caught) ?? messageFrom(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function focusFirstUnanswered() {
    const firstIndex = questions.findIndex((question) => !question.selected_answer);
    if (firstIndex < 0) return;
    const first = questions[firstIndex];
    if (!first) return;
    setPage(pageOfIndex(firstIndex, RUNNER_PAGE_SIZE));
    setFocusedId(first.id);
  }

  useEffect(() => {
    if (focusedId == null) return;
    questionRefs.current.get(focusedId)?.scrollIntoView({ block: 'center' });
  }, [focusedId, safePage]);

  async function chooseAnswer(question: StudentQuestion, selectedAnswer: string) {
    const previous = question.selected_answer;
    setQuestions((current) =>
      current.map((entry) => (entry.id === question.id ? { ...entry, selected_answer: selectedAnswer } : entry)),
    );
    setSaves((current) => ({ ...current, [question.id]: { phase: 'saving', at: Date.now() } }));
    setSaveErrors((current) => ({ ...current, [question.id]: undefined }));
    try {
      await api.patch(`/student/exams/${exam.id}/answer`, {
        question_id: question.id,
        selected_answer: selectedAnswer,
      });
      setSaves((current) => ({ ...current, [question.id]: { phase: 'saved', at: Date.now() } }));
    } catch (caught) {
      if (wasAutoSubmitted(caught)) {
        onFinished('auto_submitted');
        return;
      }
      const problem = examRunProblem(caught);
      if (problem) {
        setSessionNotice(problem);
        onAbandon(problem);
        return;
      }
      // A rejected answer is rolled back rather than left looking saved: the student must never see a
      // question marked answered when the database does not hold it.
      setQuestions((current) =>
        current.map((entry) => (entry.id === question.id ? { ...entry, selected_answer: previous } : entry)),
      );
      setSaves((current) => ({ ...current, [question.id]: null }));
      setSaveErrors((current) => ({ ...current, [question.id]: messageFrom(caught) }));
    }
  }

  async function toggleFlag(question: StudentQuestion) {
    const next = !question.is_flagged;
    setQuestions((current) =>
      current.map((entry) => (entry.id === question.id ? { ...entry, is_flagged: next } : entry)),
    );
    try {
      await api.patch(`/student/exams/${exam.id}/flag`, { question_id: question.id, is_flagged: next });
    } catch (caught) {
      if (wasAutoSubmitted(caught)) {
        onFinished('auto_submitted');
        return;
      }
      setQuestions((current) =>
        current.map((entry) => (entry.id === question.id ? { ...entry, is_flagged: !next } : entry)),
      );
      const problem = flagProblem(caught);
      if (problem) setSaveErrors((current) => ({ ...current, [question.id]: problem }));
    }
  }

  const shortClock = remaining > 0 && remaining <= SHORT_CLOCK_MS;

  useEffect(() => {
    setTop({
      title: exam.title,
      timeLeft: expired ? 'Time is up' : formatCountdown(remaining),
      shortClock,
      expired,
      answered: progress.answered,
      total: progress.total,
      flagged: progress.flagged,
    });
    return () => setTop(null);
  }, [setTop, exam.title, remaining, expired, shortClock, progress]);

  return (
    <div
      className="select-none"
      onCopy={(event) => event.preventDefault()}
      onCut={(event) => event.preventDefault()}
      onPaste={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <aside className="lg:order-2 lg:fixed lg:right-[max(1.75rem,calc((100vw-1160px)/2+1.75rem))] lg:top-[84px] lg:z-30 lg:w-[320px]" aria-label="Question overview">
          <div className="grid gap-3 rounded-xl border border-[#dfe5f0] border-t-4 border-t-accent bg-white px-5 py-[18px] shadow-[0_12px_32px_rgb(36_52_80/10%)] lg:max-h-[calc(100vh-6.5rem)] lg:overflow-auto">
            <h3>Questions</h3>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(44px,1fr))]">
              {questions.map((question, index) => {
                const answered = question.selected_answer != null && question.selected_answer !== '';
                const label = `Question ${index + 1}, ${answered ? 'answered' : 'not answered'}${question.is_flagged ? ', flagged' : ''}`;
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`relative min-h-[44px] rounded-[7px] border font-bold tabular-nums${answered ? ' border-[#b4c7ef] bg-[#eef4ff] text-primary-dark' : ' border-[#dfe5f0] bg-white'}${question.is_flagged ? " after:absolute after:bottom-[5px] after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-[#b42318] after:content-['']" : ''}${focusedId === question.id ? ' outline outline-[3px] outline-[rgb(242_132_47/45%)] outline-offset-2' : ''}`}
                    aria-label={label}
                    title={label}
                    onClick={() => {
                      setPage(pageOfIndex(index, RUNNER_PAGE_SIZE));
                      setFocusedId(question.id);
                    }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <p className="text-[0.84rem] font-normal text-muted">
              A filled cell is answered, a dot marks a flagged question, and a blank cell still needs an answer.
            </p>
            {pendingSave && <Spinner label="Saving answers" />}
            <Button
              className="w-full"
              onClick={() => {
                setConfirming(true);
                setUnanswered(null);
              }}
              disabled={submitting || expired}
            >
              Submit exam
            </Button>
          </div>
        </aside>
        <div className="grid min-w-0 gap-[22px] lg:order-1">
      {(unanswered || submitError || sessionNotice) && (
        <div className="mt-5 grid gap-[18px]" style={{ marginTop: 0 }}>
          {unanswered && <Alert>{unanswered.message}</Alert>}
          {submitError && <Alert>{submitError}</Alert>}
          {sessionNotice && <Alert variant="info">{sessionNotice}</Alert>}
        </div>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(35_47_77/55%)] p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConfirming(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-dialog-title"
            tabIndex={-1}
            className="grid w-full max-w-[520px] gap-3 rounded-xl border border-[#f2c79a] bg-[#fff8f0] p-6 shadow-[0_24px_64px_rgb(36_52_80/25%)]"
          >
            <h3 id="submit-dialog-title">Submit this exam?</h3>
            <p>{submitConfirmCopy(progress.answered, progress.total)}</p>
            <p className="font-normal text-muted">
              Submitting closes the attempt for good. You will not see your answers or your grade on this
              platform again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={submitting} onClick={() => { void submitAttempt('manual'); }}>
                {submitting ? 'Submitting…' : 'Submit exam'}
              </Button>
              <Button variant="secondary" disabled={submitting} onClick={() => setConfirming(false)}>
                Keep working
              </Button>
            </div>
          </div>
        </div>
      )}

      <ol className="m-0 grid list-none gap-[22px] p-0">
        {visibleQuestions.map((question, position) => {
          const index = pageStart + position;
          const choices = answerChoices(question);
          const save = saves[question.id] ?? null;
          const saveError = saveErrors[question.id];
          return (
            <li key={question.id}>
              <section
                ref={(node) => {
                  if (node) questionRefs.current.set(question.id, node);
                  else questionRefs.current.delete(question.id);
                }}
                className={`grid gap-3.5 rounded-xl border bg-white p-6 shadow-[0_4px_12px_rgb(36_52_80/5%)]${question.is_flagged ? ' border-[#f2c79a]' : ' border-[#dfe5f0]'}${question.selected_answer == null ? ' border-l-4 border-l-accent' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
                  <span className="font-extrabold text-primary-dark">Question {index + 1}</span>
                  {saveError && <span className="font-normal text-muted">{saveError}</span>}
                  <span className="ml-auto text-[0.82rem] font-semibold text-muted">
                    {save?.phase === 'saving' && 'Saving…'}
                    {save?.phase === 'saved' && 'Saved'}
                  </span>
                  <button
                    type="button"
                    className={`ml-1 flex min-h-[44px] items-center gap-1.5 rounded-[7px] px-2 font-semibold${question.is_flagged ? ' text-[#b42318]' : ' text-muted hover:text-primary'}`}
                    onClick={() => { void toggleFlag(question); }}
                    aria-pressed={question.is_flagged}
                    aria-label={question.is_flagged ? 'Remove flag' : 'Flag for review'}
                    title={question.is_flagged ? 'Remove flag' : 'Flag for review'}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M3.5 2v12"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M4 2.8h8.4l-2.2 3 2.2 3H4z"
                        fill={question.is_flagged ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {question.is_flagged && <span>Flagged</span>}
                  </button>
                </div>

                <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                  <legend className="font-semibold">{question.text}</legend>
                  {question.image_url && <img className="max-h-[260px] w-full max-w-full rounded-md border border-[#dfe5f0]" src={question.image_url} alt="" />}
                  <div className="grid gap-[9px]">
                    {choices.map((choice) => (
                      <label
                        key={choice.value}
                        className={`flex cursor-pointer items-center gap-3 rounded-[7px] border bg-white px-3.5 py-[11px] font-normal hover:border-primary [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:flex-none [&_input]:accent-[#455B8A]${question.selected_answer === choice.value ? ' border-primary bg-[#eef4ff]' : ' border-[#dfe5f0]'}`}
                      >
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          value={choice.value}
                          checked={question.selected_answer === choice.value}
                          disabled={expired || submitting}
                          onChange={() => { void chooseAnswer(question, choice.value); }}
                        />
                        <span>{choice.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>
            </li>
          );
        })}
      </ol>

      {pageTotal > 1 && (
        <nav
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[#dfe5f0] bg-white px-5 py-3"
          aria-label="Question pages"
        >
          <Button variant="secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            Previous
          </Button>
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: pageTotal }, (_, target) => (
              <button
                key={target}
                type="button"
                aria-label={`Page ${target + 1}`}
                aria-current={target === safePage ? 'page' : undefined}
                disabled={target === safePage}
                onClick={() => setPage(target)}
                className={`min-h-[36px] min-w-[36px] rounded-[7px] border px-2 font-bold tabular-nums${target === safePage ? ' border-primary bg-[#eef4ff] text-primary-dark' : ' border-[#dfe5f0] bg-white hover:border-primary'}`}
              >
                {target + 1}
              </button>
            ))}
          </div>
          <Button variant="secondary" disabled={safePage >= pageTotal - 1} onClick={() => setPage(safePage + 1)}>
            Next
          </Button>
          <span className="ml-auto text-[0.82rem] font-semibold text-muted">
            Page {safePage + 1} of {pageTotal} · Questions {pageStart + 1}–
            {Math.min(pageStart + RUNNER_PAGE_SIZE, questions.length)} of {questions.length}
          </span>
        </nav>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 py-1">
        {progress.unanswered > 0 ? (
          <p className="font-normal text-muted">
            {progress.unanswered} {progress.unanswered === 1 ? 'question is' : 'questions are'} still blank.
            The server will not accept a submission until every question has an answer.
          </p>
        ) : (
          <p className="font-normal text-muted">Every question has an answer. You can submit whenever you are ready.</p>
        )}
        <Button
          disabled={submitting || expired}
          onClick={() => {
            setConfirming(true);
            setUnanswered(null);
          }}
        >
          Submit exam
        </Button>
      </div>
        </div>
      </div>
    </div>
  );
}
