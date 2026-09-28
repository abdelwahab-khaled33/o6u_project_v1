/* eslint-disable react-hooks/set-state-in-effect -- the exam list and the start flow both come from the API and cannot be derived during render */
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
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

  const [codes, setCodes] = useState<Record<string, string>>({});
  const [startErrors, setStartErrors] = useState<Record<string, string | null>>({});
  const [startBusy, setStartBusy] = useState<string | null>(null);

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
      <Card className="stacked-card">
        <h2>{running.exam.title} — finished</h2>
        <div className="form-stack">
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
          <p className="muted">
            You will not see your answers or your grade on this platform again. If anything still needs your
            attention, your instructor will reach you directly.
          </p>
          <div className="row-actions">
            <Button onClick={() => { void backToList(); }}>Back to my exams</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <Card>
        <h2>My exams</h2>
        <p className="page-intro">
          Exams and quizzes open to you right now. A quiz is a short check from your TA; an exam is set by a
          doctor and needs the access code your supervisor announces. Once you start, the clock cannot be
          paused — when time runs out, your saved answers are submitted automatically.
        </p>
        {listError && <Alert>{listError}</Alert>}
        <div className="form-stack">
          {loading ? (
            <div><Spinner label="Loading your exams" /> Loading your exams…</div>
          ) : exams.length === 0 ? (
            <EmptyState>
              You have no exams open right now. When an exam or quiz you are registered for opens, it appears
              here.
            </EmptyState>
          ) : (
            exams.map((exam) => {
              const code = codes[exam.id] ?? '';
              const codeProblem = accessCodeInputProblem(code);
              return (
                <section key={exam.id} className="student-exam-row">
                  <div className="student-exam-copy">
                    <div className="row-actions">
                      <span className="question-text"><strong>{exam.title}</strong></span>
                      <span className="status">{exam.type === 'ta_quiz' ? 'Quiz' : 'Exam'}</span>
                    </div>
                    <div className="muted">
                      {exam.subject.code} — {exam.subject.name}
                    </div>
                    <div className="muted">
                      {formatDateTime(exam.start_time)} to {formatDateTime(exam.end_time)} · {exam.duration_minutes}
                      {' '}min · {formatGrade(exam.points_per_question)} points per question
                    </div>
                  </div>

                  <div className="student-exam-action">
                    {exam.status === 'in_progress' ? (
                      <>
                        <p className="muted">
                          You already started this exam. Your answers are saved; resume when you are ready.
                        </p>
                        <div className="row-actions">
                          <Button disabled={startBusy === exam.id} onClick={() => { void startExam(exam, null); }}>
                            {startBusy === exam.id ? 'Opening…' : 'Resume'}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="row-actions">
                          <Input
                            className="access-input"
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={6}
                            placeholder="Access code"
                            aria-label={`Access code for ${exam.title}`}
                            value={code}
                            onChange={(event) => {
                              const normalised = normaliseAccessCode(event.target.value);
                              setCodes((current) => ({ ...current, [exam.id]: normalised }));
                              setStartErrors((current) => ({ ...current, [exam.id]: null }));
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void startExam(exam, code);
                              }
                            }}
                          />
                          <Button
                            disabled={startBusy === exam.id || codeProblem !== null}
                            onClick={() => { void startExam(exam, code); }}
                          >
                            {startBusy === exam.id ? 'Starting…' : 'Start'}
                          </Button>
                        </div>
                        {codeProblem != null && code !== '' ? (
                          <p className="muted">{codeProblem}</p>
                        ) : (
                          <p className="muted">
                            Your supervisor announces the 6-character access code when this exam opens.
                          </p>
                        )}
                      </>
                    )}
                    {startErrors[exam.id] && <Alert>{startErrors[exam.id]}</Alert>}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}