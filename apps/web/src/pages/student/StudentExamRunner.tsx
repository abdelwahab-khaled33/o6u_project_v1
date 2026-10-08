import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { STATUS_PILL } from '../../lib/statusTone';
import { messageFrom } from '../admin/adminShared';
import {
  answerChoices,
  clockOffsetMs,
  examRunProblem,
  flagProblem,
  formatCountdown,
  isTimeUp,
  progressSummary,
  remainingMs,
  submitBlockedNotice,
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
  const [fullscreen, setFullscreen] = useState(false);

  const submittingRef = useRef(false);
  const deadlineHandledRef = useRef(false);
  const questionRefs = useRef(new Map<string, HTMLElement>());

  const remaining = remainingMs(attempt.deadline_at, offsetMs, now);
  const expired = attempt.deadline_at != null && isTimeUp(remaining);
  const progress = useMemo(() => progressSummary(questions), [questions]);
  const pendingSave = Object.values(saves).some((entry) => entry?.phase === 'saving');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement != null);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
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
    const first = questions.find((question) => !question.selected_answer);
    if (!first) return;
    setFocusedId(first.id);
    questionRefs.current.get(first.id)?.scrollIntoView({ block: 'center' });
    questionRefs.current
      .get(first.id)
      ?.querySelector<HTMLInputElement>('input[type="radio"]')
      ?.focus();
  }

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

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreen(true);
    } catch {
      setSessionNotice('This browser would not go fullscreen. The exam still works, but keep this window alone.');
    }
  }

  const shortClock = remaining > 0 && remaining <= SHORT_CLOCK_MS;

  return (
    <div
      className="grid select-none gap-[22px]"
      onCopy={(event) => event.preventDefault()}
      onCut={(event) => event.preventDefault()}
      onPaste={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="sticky top-3 z-20 grid items-center gap-x-[22px] gap-y-2 rounded-xl border border-[#dfe5f0] border-t-4 border-t-accent bg-white p-4 shadow-[0_12px_32px_rgb(36_52_80/10%)] [grid-template-columns:minmax(0,1fr)_auto] max-md:grid-cols-1">
        <div className="grid min-w-0 gap-[3px] text-[1.05rem] font-bold">
          <strong>{exam.title}</strong>
          <span className="font-normal text-muted">
            {exam.subject.code} — {exam.subject.name}
          </span>
        </div>

        <div className="grid min-w-[150px] gap-0.5 text-right max-md:text-left">
          <span className="text-[0.8rem] font-bold uppercase tracking-[0.05em] text-muted">Time left</span>
          <span
            className={`font-extrabold tabular-nums leading-none tracking-wide text-primary-dark${shortClock ? ' text-accent' : ''}${expired ? ' text-[#b42318]' : ''}`}
            role="timer"
            aria-live="off"
            aria-label={`${formatCountdown(remaining)} remaining`}
          >
            {expired ? 'Time is up' : formatCountdown(remaining)}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-[26px] gap-y-2 [grid-column:1/-1]">
          <div className="flex items-baseline gap-2">
            <span className="text-[0.8rem] font-bold uppercase tracking-[0.05em] text-muted">Answered</span>
            <span className="font-extrabold tabular-nums">
              {progress.answered} of {progress.total}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[0.8rem] font-bold uppercase tracking-[0.05em] text-muted">To do</span>
            <span className={`font-extrabold tabular-nums${progress.unanswered > 0 ? ' text-[#b42318]' : ''}`}>{progress.unanswered}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[0.8rem] font-bold uppercase tracking-[0.05em] text-muted">Flagged</span>
            <span className="font-extrabold tabular-nums">{progress.flagged}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 [grid-column:1/-1]">
          {pendingSave && <Spinner label="Saving answers" />}
          <Button variant="secondary" onClick={() => { void enterFullscreen(); }} disabled={fullscreen}>
            {fullscreen ? 'Fullscreen on' : 'Go fullscreen'}
          </Button>
          <Button
            onClick={() => {
              setConfirming(true);
              setUnanswered(null);
            }}
            disabled={submitting || expired}
          >
            Submit exam
          </Button>
        </div>
      </div>

      {(unanswered || submitError || sessionNotice) && (
        <div className="mt-5 grid gap-[18px]" style={{ marginTop: 0 }}>
          {unanswered && <Alert>{unanswered.message}</Alert>}
          {submitError && <Alert>{submitError}</Alert>}
          {sessionNotice && <Alert variant="info">{sessionNotice}</Alert>}
        </div>
      )}

      {confirming && (
        <Cardish>
          <h3>Submit this exam?</h3>
          <p>
            You have answered {progress.answered} of {progress.total} questions
            {progress.unanswered > 0
              ? `. ${progress.unanswered} ${progress.unanswered === 1 ? 'question is' : 'questions are'} still blank, so the server will refuse the submission until you answer ${progress.unanswered === 1 ? 'it' : 'them'}.`
              : '. Every question is answered.'}
          </p>
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
        </Cardish>
      )}

      <nav className="grid gap-3 rounded-xl border border-[#dfe5f0] bg-white px-5 py-[18px]" aria-label="Question overview">
        <h3>Questions</h3>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(44px,1fr))]">
          {questions.map((question, index) => {
            const answered = question.selected_answer != null && question.selected_answer !== '';
            const label = `Question ${index + 1}, ${answered ? 'answered' : 'not answered'}${question.is_flagged ? ', flagged' : ''}`;
            return (
              <button
                key={question.id}
                type="button"
                className={`relative min-h-[44px] rounded-[7px] border font-bold tabular-nums${answered ? ' border-[#b4c7ef] bg-[#eef4ff] text-primary-dark' : ' border-[#dfe5f0] bg-white'}${question.is_flagged ? " after:absolute after:bottom-[5px] after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-accent after:content-['']" : ''}${focusedId === question.id ? ' outline outline-[3px] outline-[rgb(242_132_47/45%)] outline-offset-2' : ''}`}
                aria-label={label}
                title={label}
                onClick={() => {
                  setFocusedId(question.id);
                  questionRefs.current.get(question.id)?.scrollIntoView({ block: 'center' });
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
      </nav>

      <ol className="m-0 grid list-none gap-[22px] p-0">
        {questions.map((question, index) => {
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
                  <span className={`${STATUS_PILL} border-[#dfe5f0] bg-[#edf0f6] text-muted`}>{question.difficulty}</span>
                  {saveError && <span className="font-normal text-muted">{saveError}</span>}
                  <span className="ml-auto text-[0.82rem] font-semibold text-muted">
                    {save?.phase === 'saving' && 'Saving…'}
                    {save?.phase === 'saved' && 'Saved'}
                  </span>
                  <Button
                    variant="text"
                    className="ml-1"
                    onClick={() => { void toggleFlag(question); }}
                    aria-pressed={question.is_flagged}
                  >
                    {question.is_flagged ? 'Flagged — remove' : 'Flag for review'}
                  </Button>
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
  );
}

function Cardish({ children }: { children: ReactNode }) {
  return <section className="grid gap-3 rounded-xl border border-[#f2c79a] bg-[#fff8f0] px-5 py-[18px]">{children}</section>;
}
