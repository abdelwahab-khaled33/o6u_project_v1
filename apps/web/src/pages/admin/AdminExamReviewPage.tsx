/* eslint-disable react-hooks/set-state-in-effect -- this page loads one exam from the API and cannot derive it during render */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { STATUS_PILL, statusTone } from '../../lib/statusTone';
import { describeError, EmptyState, formatDateTime, humanise } from './adminShared';
import {
  answerabilityProblem,
  buildAdminEditBody,
  formatReviewGrade,
  toLocalInputValue,
  type AdminEditDraft,
  type ReviewQuestion,
} from './examReviewModel';

type ReviewExam = {
  id: string;
  title: string;
  type: string;
  status: string;
  subject: { code: string; name: string };
  owner: { full_name: string };
  start_time: string;
  end_time: string;
  duration_minutes: number;
  points_per_question: number | string;
  difficulty_mix: { easy: number; medium: number; hard: number };
  target_scope: string;
  rejection_reason: string | null;
  approved_at: string | null;
  access_code_expires_at: string | null;
  pool_questions: Array<{ question: ReviewQuestion }>;
};

const EMPTY_DRAFT: AdminEditDraft = { title: '', startTime: '', endTime: '', durationMinutes: '', pointsPerQuestion: '' };

function QuestionCard({ entry, index }: { entry: { question: ReviewQuestion }; index: number }) {
  const question = entry.question;
  const problem = answerabilityProblem(question);
  const options = Array.isArray(question.options) ? question.options.map(String) : [];
  return (
    <section className="grid gap-3.5 rounded-xl border border-[#dfe5f0] bg-white p-6 shadow-[0_4px_12px_rgb(36_52_80/5%)]" aria-label={`Question ${index + 1}`}>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <span className="font-extrabold text-primary-dark">Question {index + 1}</span>
        <span className={`${STATUS_PILL} border-[#dfe5f0] bg-[#edf0f6] text-muted`}>{humanise(question.question_type)}</span>
        <span className={`${STATUS_PILL} border-[#dfe5f0] bg-[#edf0f6] text-muted`}>{humanise(question.difficulty)}</span>
        <span className="font-normal text-muted">Grade {formatReviewGrade(question.grade)}</span>
        {question.is_archived && <span className={`${STATUS_PILL} ${statusTone('rejected')}`}>Archived</span>}
      </div>
      <p className="font-semibold">{question.text}</p>
      {question.image_url && (
        <img className="max-h-[260px] w-full max-w-full rounded-md border border-[#dfe5f0]" src={question.image_url} alt={`Illustration for question ${index + 1}`} />
      )}
      {options.length > 0 && (
        <ul className="grid gap-[3px] pl-5 font-normal text-muted">
          {options.map((option) => (
            <li key={option} className={option === question.correct_answer ? 'font-bold text-[#147a47]' : undefined}>
              {option}{option === question.correct_answer ? ' — correct answer' : ''}
            </li>
          ))}
        </ul>
      )}
      {question.question_type === 'true_false' && (
        <p className="font-normal text-muted">Correct answer: {question.correct_answer}</p>
      )}
      {problem !== null && <Alert>{problem}</Alert>}
    </section>
  );
}

export function AdminExamReviewPage() {
  const { examId } = useParams();
  const [exam, setExam] = useState<ReviewExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminEditDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const loadExam = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ exam: ReviewExam }>(`/exams/${examId}`);
      setExam(result.exam);
      setDraft({
        title: result.exam.title,
        startTime: toLocalInputValue(result.exam.start_time),
        endTime: toLocalInputValue(result.exam.end_time),
        durationMinutes: String(result.exam.duration_minutes),
        pointsPerQuestion: String(result.exam.points_per_question),
      });
      setError(null);
    } catch (caught) {
      setExam(null);
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => { void loadExam(); }, [loadExam]);

  function updateDraft(key: keyof AdminEditDraft, value: string) {
    setSaved(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exam) return;
    // Compare against the stored values, not against blanks: the form is pre-filled, so an
    // untouched field still holds the current value and must not travel as a "change".
    const body = buildAdminEditBody({
      title: draft.title.trim() === exam.title ? '' : draft.title,
      startTime: draft.startTime === toLocalInputValue(exam.start_time) ? '' : draft.startTime,
      endTime: draft.endTime === toLocalInputValue(exam.end_time) ? '' : draft.endTime,
      durationMinutes: draft.durationMinutes === String(exam.duration_minutes) ? '' : draft.durationMinutes,
      pointsPerQuestion: draft.pointsPerQuestion === String(exam.points_per_question) ? '' : draft.pointsPerQuestion,
    });
    if (Object.keys(body).length === 0) {
      setSaved('Nothing changed — the exam already holds these values.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const result = await api.patch<{ exam: ReviewExam }>(`/exams/${exam.id}`, body);
      setExam(result.exam);
      setDraft({
        title: result.exam.title,
        startTime: toLocalInputValue(result.exam.start_time),
        endTime: toLocalInputValue(result.exam.end_time),
        durationMinutes: String(result.exam.duration_minutes),
        pointsPerQuestion: String(result.exam.points_per_question),
      });
      setSaved('Saved. The exam keeps its current status — approval stays a separate action on the Exams list.');
    } catch (caught) {
      // A started exam answers 409 here with the server's own wording; it is shown verbatim
      // rather than mapped, because the time lock is the server's rule, not the screen's.
      setSaveError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Card><Spinner label="Loading exam" /> Loading exam…</Card>;
  }

  if (error !== null || exam === null) {
    return (
      <Card>
        <p><Link to="/admin/exams">Back to Exams</Link></p>
        {error !== null ? <Alert>{error}</Alert> : <EmptyState>This exam does not exist.</EmptyState>}
      </Card>
    );
  }

  const problems = exam.pool_questions.map((entry) => answerabilityProblem(entry.question));
  const problemCount = problems.filter((problem) => problem !== null).length;

  return (
    <div className="grid content-start gap-5">
      <p><Link to="/admin/exams">Back to Exams</Link></p>
      <Card>
        <h2>{exam.title}</h2>
        <p className="font-normal text-muted">
          {humanise(exam.type)} in {exam.subject.code} — {exam.subject.name}, owned by {exam.owner.full_name}.
        </p>
        <dl className="m-0 grid gap-0 [overflow-wrap:anywhere] [&_dd]:m-0 [&_div]:grid [&_div]:gap-3.5 [&_div]:border-b [&_div]:border-[#dfe5f0] [&_div]:py-[9px] [&_div]:[grid-template-columns:190px_1fr] [&_dt]:font-semibold [&_dt]:text-muted max-md:[&_div]:grid-cols-1">
          <div><dt>Status</dt><dd>{humanise(exam.status)}</dd></div>
          <div><dt>Starts</dt><dd>{formatDateTime(exam.start_time)}</dd></div>
          <div><dt>Ends</dt><dd>{formatDateTime(exam.end_time)}</dd></div>
          <div><dt>Duration</dt><dd>{exam.duration_minutes} minutes</dd></div>
          <div><dt>Points per question</dt><dd>{formatReviewGrade(exam.points_per_question)}</dd></div>
          <div><dt>Difficulty mix</dt><dd>Easy {exam.difficulty_mix.easy} · Medium {exam.difficulty_mix.medium} · Hard {exam.difficulty_mix.hard}</dd></div>
          <div><dt>Target scope</dt><dd>{humanise(exam.target_scope)}</dd></div>
          <div><dt>Questions in pool</dt><dd>{exam.pool_questions.length}{problemCount > 0 ? ` — ${problemCount} need attention` : ''}</dd></div>
          {exam.rejection_reason && <div><dt>Rejection reason</dt><dd>{exam.rejection_reason}</dd></div>}
          {exam.approved_at && <div><dt>Approved at</dt><dd>{formatDateTime(exam.approved_at)}</dd></div>}
          {exam.access_code_expires_at && <div><dt>Access code expires</dt><dd>{formatDateTime(exam.access_code_expires_at)}</dd></div>}
        </dl>
      </Card>

      <Card>
        <h2>Edit exam</h2>
        <p className="font-normal text-muted">
          Title, schedule, duration and points. The question pool and targets stay with the owning doctor —
          this screen never touches them.
        </p>
        {saveError && <Alert>{saveError}</Alert>}
        {saved && <Alert variant="success">{saved}</Alert>}
        <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void save(event); }}>
          <Field label="Title" htmlFor="review-title">
            <Input id="review-title" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} required />
          </Field>
          <Field label="Start time" htmlFor="review-start">
            <Input id="review-start" type="datetime-local" value={draft.startTime} onChange={(event) => updateDraft('startTime', event.target.value)} required />
          </Field>
          <Field label="End time" htmlFor="review-end">
            <Input id="review-end" type="datetime-local" value={draft.endTime} onChange={(event) => updateDraft('endTime', event.target.value)} required />
          </Field>
          <Field label="Duration (minutes)" htmlFor="review-duration">
            <Input id="review-duration" type="number" min={1} value={draft.durationMinutes} onChange={(event) => updateDraft('durationMinutes', event.target.value)} required />
          </Field>
          <Field label="Points per question" htmlFor="review-points">
            <Input id="review-points" type="number" min={0.01} step={0.01} value={draft.pointsPerQuestion} onChange={(event) => updateDraft('pointsPerQuestion', event.target.value)} required />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </Card>

      <h2>Questions ({exam.pool_questions.length})</h2>
      {exam.pool_questions.length === 0 ? (
        <Card><EmptyState>This exam has no questions in its pool.</EmptyState></Card>
      ) : (
        exam.pool_questions.map((entry, index) => <QuestionCard key={entry.question.id} entry={entry} index={index} />)
      )}
    </div>
  );
}
