/* eslint-disable react-hooks/set-state-in-effect -- subjects, the bank and the exam being edited are all fetched from the API; none of them can be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIFFICULTIES, type Difficulty } from '@exam/shared';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { describeError, EmptyState, formatDateTime, plural, type Subject } from '../admin/adminShared';
import { formatGrade, type BankQuestion } from './DoctorQuestionForm';
import {
  archivedPoolProblem,
  buildExamPayload,
  DURATION_MAX,
  isoToLocal,
  localToIso,
  POINTS_DECIMALS,
  POINTS_MAX,
  POINTS_MIN,
  TITLE_MAX,
  wizardProblems,
  type TargetScope,
  type WizardForm,
} from './examWizardModel';
import {
  editOutcomeExplainer,
  editOutcomeNotice,
  pointsValue,
  type ExamDetail,
  type ExamStatus,
} from './doctorExamTypes';

const SCOPES: { value: TargetScope; label: string; hint: string; available: boolean }[] = [
  {
    value: 'subject',
    label: 'Everyone enrolled in the subject',
    hint: 'Attempts are generated for every student enrolled in the subject when the exam is approved.',
    available: true,
  },
  {
    value: 'sections',
    label: 'Specific sections',
    hint: 'Not available: the section roster lives behind GET /admin/sections, which is admin-only, so a doctor has nothing to pick from yet.',
    available: false,
  },
  {
    value: 'student_list',
    label: 'A specific list of students',
    hint: 'Not available: the student roster lives behind GET /admin/users, which is admin-only, so a doctor has nothing to pick from yet.',
    available: false,
  },
];

function defaultStartLocal(): string {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  return isoToLocal(start.toISOString());
}

function defaultEndLocal(): string {
  const end = new Date();
  end.setDate(end.getDate() + 1);
  end.setHours(11, 0, 0, 0);
  return isoToLocal(end.toISOString());
}

function emptyForm(subjectId: string): WizardForm {
  return {
    subjectId,
    title: '',
    poolIds: [],
    mix: { easy: 0, medium: 0, hard: 0 },
    pointsPerQuestion: '2',
    durationMinutes: '60',
    startLocal: defaultStartLocal(),
    endLocal: defaultEndLocal(),
    targetScope: 'subject',
    targetSectionIds: [],
    targetStudentIds: [],
  };
}

function formFromExam(exam: ExamDetail): WizardForm {
  return {
    subjectId: exam.subject_id,
    title: exam.title,
    poolIds: exam.pool_questions.map((link) => link.question_id),
    mix: {
      easy: exam.difficulty_mix.easy ?? 0,
      medium: exam.difficulty_mix.medium ?? 0,
      hard: exam.difficulty_mix.hard ?? 0,
    },
    pointsPerQuestion: String(pointsValue(exam.points_per_question)),
    durationMinutes: String(exam.duration_minutes),
    startLocal: isoToLocal(exam.start_time),
    endLocal: isoToLocal(exam.end_time),
    targetScope: exam.target_scope,
    targetSectionIds: exam.target_sections.map((row) => row.section_id),
    targetStudentIds: exam.target_students.map((row) => row.student_id),
  };
}

/** How many of each difficulty the bank holds, and how many of those the doctor has ticked. This is the
 *  one number the doctor actually has to reason about, so it is shown per tier rather than as a total. */
function Coverage({ tier, required, selected, available }: {
  tier: Difficulty;
  required: number;
  selected: number;
  available: number;
}) {
  const enough = required === 0 || selected >= required;
  return (
    <div className="grid gap-[5px] rounded-md border border-[#dfe5f0] bg-[#edf0f6] px-3 py-2.5" key={tier}>
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-semibold capitalize text-primary-dark">{tier}</span>
        <span className={enough ? 'text-[0.85rem] font-bold text-[#147a47]' : 'text-[0.85rem] font-bold text-[#b42318]'}>
          {selected} selected of {required} required
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#e3e8f2]" aria-hidden="true">
        <div
          className={enough ? 'h-full bg-[#147a47]' : 'h-full bg-[#b42318]'}
          style={{ width: `${required === 0 ? 100 : Math.min(100, (selected / required) * 100)}%` }}
        />
      </div>
      <span className="font-normal text-muted">{available} in your bank at this difficulty</span>
    </div>
  );
}

export function ExamWizard({ examId }: { examId?: string }) {
  const editing = examId !== undefined;
  const navigate = useNavigate();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [form, setForm] = useState<WizardForm>(() => emptyForm(''));
  const [archivedPool, setArchivedPool] = useState<{ id: string; text: string; difficulty: Difficulty }[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | ''>('');
  const [loadedStatus, setLoadedStatus] = useState<ExamStatus | null>(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingExam, setLoadingExam] = useState(editing);
  const [loadingBank, setLoadingBank] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void (async () => {
    try {
      setSubjects((await api.get<{ subjects: Subject[] }>('/subjects')).subjects);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingSubjects(false);
    }
  })(); }, []);

  useEffect(() => { if (!editing || examId === undefined) return; void (async () => {
    setLoadingExam(true);
    try {
      const exam = (await api.get<{ exam: ExamDetail }>(`/exams/${examId}`)).exam;
      setForm(formFromExam(exam));
      // The bank never contains archived rows, so the archived pool cannot be derived from it.
      // It comes from the detail response, which carries is_archived per pool question.
      setArchivedPool(
        exam.pool_questions
          .filter((link) => link.question.is_archived === true)
          .map((link) => ({ id: link.question_id, text: link.question.text, difficulty: link.question.difficulty })),
      );
      setLoadedStatus(exam.status);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingExam(false);
    }
  })(); }, [editing, examId]);

  const loadBank = useCallback(async (subjectId: string) => {
    if (subjectId === '') {
      setBank([]);
      return;
    }
    setLoadingBank(true);
    try {
      setBank((await api.get<{ questions: BankQuestion[] }>(
        `/question-bank?subject_id=${encodeURIComponent(subjectId)}`,
      )).questions);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingBank(false);
    }
  }, []);

  useEffect(() => { void loadBank(form.subjectId); }, [loadBank, form.subjectId]);

  const selected = useMemo(() => new Set(form.poolIds), [form.poolIds]);
  // poolIds keeps archived ids by design: dropping them silently would hide state the server still
  // holds, so they stay selected and render below as a stated problem until removed.
  const archivedIds = useMemo(() => archivedPool.map((question) => question.id), [archivedPool]);
  const selectedArchived = useMemo(
    () => archivedPool.filter((question) => selected.has(question.id)),
    [archivedPool, selected],
  );
  const problems = wizardProblems(form, bank, { archivedIds });
  const valid = problems.length === 0;

  const bankByDifficulty = useMemo(() => {
    const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const question of bank) counts[question.difficulty] += 1;
    return counts;
  }, [bank]);

  const selectedByDifficulty = useMemo(() => {
    const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const question of bank) {
      if (selected.has(question.id)) counts[question.difficulty] += 1;
    }
    return counts;
  }, [bank, selected]);

  const visibleBank = useMemo(
    () => (difficultyFilter === '' ? bank : bank.filter((question) => question.difficulty === difficultyFilter)),
    [bank, difficultyFilter],
  );

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === form.subjectId) ?? null,
    [subjects, form.subjectId],
  );

  function patch(changes: Partial<WizardForm>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function setMix(tier: Difficulty, raw: string) {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    patch({ mix: { ...form.mix, [tier]: value } });
  }

  function toggleQuestion(id: string) {
    patch({
      poolIds: selected.has(id) ? form.poolIds.filter((each) => each !== id) : [...form.poolIds, id],
    });
  }

  function removeArchived(id: string) {
    patch({ poolIds: form.poolIds.filter((each) => each !== id) });
  }

  function selectVisible() {
    patch({ poolIds: [...new Set([...form.poolIds, ...visibleBank.map((question) => question.id)])] });
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const payload = buildExamPayload(form, { includeSubject: !editing });
    try {
      if (editing && examId !== undefined) {
        const saved = (await api.patch<{ exam: ExamDetail }>(`/exams/${examId}`, payload)).exam;
        // The status comes back from the server rather than being predicted, because only an exam that
        // was approved goes back into the queue and everything else keeps the status it had.
        void navigate('/doctor/exams', { state: { notice: editOutcomeNotice(saved.status, payload.title) } });
      } else {
        await api.post('/exams', payload);
        void navigate('/doctor/exams', { state: { notice: `Created "${payload.title}". It is waiting for an administrator to approve it.` } });
      }
    } catch (caught) {
      setError(describeError(caught));
      setSaving(false);
    }
  }

  if (loadingSubjects || loadingExam) {
    return <div><Spinner label="Loading the exam" /> Loading…</div>;
  }

  return (
    <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Alert>{error}</Alert>}

      {subjects.length === 0 ? (
        <Card>
          <h2>{editing ? 'Edit exam' : 'New exam'}</h2>
          <EmptyState>
            No subject is assigned to you, so there is nothing to attach an exam to. An administrator assigns
            subjects to doctors; once one is assigned, it appears here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-3 border-b border-[#dfe5f0] pb-3">
              <h2><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-primary text-[0.82rem] text-white">1</span> Subject and title</h2>
            </div>
            <div className="mt-5 grid gap-[18px]">
              <Field label="Subject" htmlFor="wizard-subject">
                <Select
                  id="wizard-subject"
                  value={form.subjectId}
                  disabled={editing}
                  onChange={(event) => patch({
                    subjectId: event.target.value,
                    poolIds: [],
                    mix: { easy: 0, medium: 0, hard: 0 },
                  })}
                >
                  <option value="" disabled>Select a subject</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>
                  ))}
                </Select>
              </Field>
              {editing && (
                <p className="font-normal text-muted">
                  The subject is fixed: an exam cannot move between subjects, because its questions, its
                  targets and its generated attempts all belong to the subject it was created in.
                </p>
              )}
              <Field label="Title" htmlFor="wizard-title">
                <Input
                  id="wizard-title"
                  value={form.title}
                  maxLength={TITLE_MAX + 20}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="Compiler final"
                  required
                />
              </Field>
              <span className="font-normal text-muted">Between 2 and {TITLE_MAX} characters. Students see this title.</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 border-b border-[#dfe5f0] pb-3">
              <h2><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-primary text-[0.82rem] text-white">2</span> Question pool and difficulty mix</h2>
            </div>
            <p className="font-normal text-muted">
              The pool is the set of questions the exam draws from. Each student is then given their own
              sample matching the mix you set here, with the questions and their options in a different order
              for every student.
            </p>

            <div className="mt-5 grid gap-[18px]">
              <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                <legend className="font-normal text-muted">How many questions of each difficulty should each student answer?</legend>
                <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(165px,1fr))]">
                  {DIFFICULTIES.map((tier) => (
                    <Field key={tier} label={tier} htmlFor={`wizard-mix-${tier}`}>
                      <Input
                        id={`wizard-mix-${tier}`}
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        value={String(form.mix[tier])}
                        onChange={(event) => setMix(tier, event.target.value)}
                      />
                    </Field>
                  ))}
                </div>
                <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
                  {DIFFICULTIES.map((tier) => (
                    <Coverage
                      key={tier}
                      tier={tier}
                      required={form.mix[tier]}
                      selected={selectedByDifficulty[tier]}
                      available={bankByDifficulty[tier]}
                    />
                  ))}
                </div>
                {selectedArchived.length > 0 && (
                  <p className="font-normal text-muted">
                    {archivedPoolProblem(selectedArchived.length)} The counts above count only
                    questions that can still be used.
                  </p>
                )}
              </fieldset>

              <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <Field label="Show" htmlFor="wizard-bank-difficulty">
                  <Select
                    id="wizard-bank-difficulty"
                    value={difficultyFilter}
                    onChange={(event) => setDifficultyFilter(event.target.value as Difficulty | '')}
                  >
                    <option value="">All difficulties</option>
                    {DIFFICULTIES.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
                  </Select>
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" onClick={selectVisible} disabled={visibleBank.length === 0}>
                    Select all shown
                  </Button>
                  <Button type="button" variant="text" onClick={() => patch({ poolIds: [] })} disabled={form.poolIds.length === 0}>
                    Clear selection
                  </Button>
                </div>
              </div>

              {selectedArchived.length > 0 && (
                <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                  <legend className="font-normal text-muted">
                    {selectedArchived.length === 1
                      ? '1 question in your pool can no longer be used'
                      : `${selectedArchived.length} questions in your pool can no longer be used`}
                  </legend>
                  <ul className="m-0 grid max-h-[340px] list-none gap-0.5 overflow-y-auto rounded-md border border-[#dfe5f0] bg-white p-1.5 [&_li:hover]:bg-[#edf0f6] [&_li]:rounded [&_li]:px-[7px] [&_li]:py-[5px]">
                    {selectedArchived.map((question) => (
                      <li key={question.id}>
                        <div className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]">
                          <input
                            id={`wizard-archived-${question.id}`}
                            type="checkbox"
                            checked={false}
                            disabled
                            aria-disabled="true"
                          />
                          <span className="w-[62px] flex-none text-[0.8rem] font-bold capitalize text-primary">{question.difficulty}</span>
                          <span className="max-w-[460px] [overflow-wrap:anywhere]">{question.text}</span>
                        </div>
                        <p className="font-normal text-muted">
                          This question was deleted (archived) and cannot be used in an exam.
                          Saving is blocked until it is removed. The server refuses it with
                          “Some pool questions were not found or are archived”.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="secondary" onClick={() => removeArchived(question.id)}>
                            Remove this question
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              {loadingBank ? (
                <div><Spinner label="Loading your questions" /> Loading your questions…</div>
              ) : !selectedSubject ? (
                <EmptyState>Choose a subject above to pick questions from its bank.</EmptyState>
              ) : bank.length === 0 ? (
                <EmptyState>{`You have no questions in ${selectedSubject.code} yet. Add some in the question bank first.`}</EmptyState>
              ) : visibleBank.length === 0 ? (
                <EmptyState>No questions at that difficulty. Choose a different filter.</EmptyState>
              ) : (
                <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                  <legend className="font-normal text-muted">
                    {form.poolIds.length} of {bank.length} questions in the pool
                  </legend>
                  <ul className="m-0 grid max-h-[340px] list-none gap-0.5 overflow-y-auto rounded-md border border-[#dfe5f0] bg-white p-1.5 [&_li:hover]:bg-[#edf0f6] [&_li]:rounded [&_li]:px-[7px] [&_li]:py-[5px]">
                    {visibleBank.map((question) => (
                      <li key={question.id}>
                        <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" htmlFor={`wizard-pick-${question.id}`}>
                          <input
                            id={`wizard-pick-${question.id}`}
                            type="checkbox"
                            checked={selected.has(question.id)}
                            onChange={() => toggleQuestion(question.id)}
                          />
                          <span className="w-[62px] flex-none text-[0.8rem] font-bold capitalize text-primary">{question.difficulty}</span>
                          <span className="max-w-[460px] [overflow-wrap:anywhere]">{question.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 border-b border-[#dfe5f0] pb-3">
              <h2><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-primary text-[0.82rem] text-white">3</span> Schedule and scoring</h2>
            </div>
            <div className="mt-5 grid gap-[18px]">
              <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(165px,1fr))]">
                <Field label="Starts" htmlFor="wizard-start">
                  <Input
                    id="wizard-start"
                    type="datetime-local"
                    value={form.startLocal}
                    onChange={(event) => patch({ startLocal: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Ends" htmlFor="wizard-end">
                  <Input
                    id="wizard-end"
                    type="datetime-local"
                    value={form.endLocal}
                    onChange={(event) => patch({ endLocal: event.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(165px,1fr))]">
                <Field label="Minutes a student has" htmlFor="wizard-duration">
                  <Input
                    id="wizard-duration"
                    type="number"
                    min="1"
                    max={DURATION_MAX}
                    step="1"
                    value={form.durationMinutes}
                    onChange={(event) => patch({ durationMinutes: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Points per question" htmlFor="wizard-points">
                  <Input
                    id="wizard-points"
                    type="number"
                    min={POINTS_MIN}
                    max={POINTS_MAX}
                    step="0.01"
                    value={form.pointsPerQuestion}
                    onChange={(event) => patch({ pointsPerQuestion: event.target.value })}
                    required
                  />
                </Field>
              </div>
              <p className="font-normal text-muted">
                A student's deadline is the earlier of their own start plus these minutes, and the end time
                above, so a student who begins late does not gain extra time. This value is the whole score
                of the exam: the grade stored with each question is not used for scoring. It is kept with{' '}
                {POINTS_DECIMALS} decimal places, between {POINTS_MIN} and {POINTS_MAX}, because that is all
                the score column can store — anything smaller would silently become zero.
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 border-b border-[#dfe5f0] pb-3">
              <h2><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-primary text-[0.82rem] text-white">4</span> Who takes it</h2>
            </div>
            <div className="mt-5 grid gap-[18px]">
              <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                <legend className="font-normal text-muted">Target</legend>
                {SCOPES.map((scope) => (
                  <label
                    className={scope.available ? 'flex items-start gap-2.5 py-[7px] font-semibold [&_input]:mt-[3px] [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:flex-none [&_input]:accent-[#455B8A]' : 'flex items-start gap-2.5 py-[7px] font-normal text-muted [&_input]:mt-[3px] [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:flex-none [&_input]:accent-[#455B8A]'}
                    key={scope.value}
                    htmlFor={`wizard-scope-${scope.value}`}
                  >
                    <input
                      id={`wizard-scope-${scope.value}`}
                      type="radio"
                      name="target_scope"
                      value={scope.value}
                      disabled={!scope.available}
                      checked={form.targetScope === scope.value}
                      onChange={() => patch({ targetScope: scope.value })}
                    />
                    <span>
                      {scope.label}
                      <span className="font-normal text-muted"> — {scope.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          </Card>

          <Card className="mt-2 border-t-4 border-t-accent">
            <div className="flex items-center gap-3 border-b border-[#dfe5f0] pb-3">
              <h2><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-primary text-[0.82rem] text-white">5</span> Review</h2>
            </div>
            <dl className="m-0 grid gap-0 [overflow-wrap:anywhere] [&_dd]:m-0 [&_div]:grid [&_div]:gap-3.5 [&_div]:border-b [&_div]:border-[#dfe5f0] [&_div]:py-[9px] [&_div]:[grid-template-columns:190px_1fr] [&_dt]:font-semibold [&_dt]:text-muted max-md:[&_div]:grid-cols-1">
              <div><dt>Title</dt><dd>{form.title.trim() === '' ? '—' : form.title.trim()}</dd></div>
              <div><dt>Subject</dt><dd>{selectedSubject ? `${selectedSubject.code} — ${selectedSubject.name}` : '—'}</dd></div>
              <div>
                <dt>Each student answers</dt>
                <dd>
                  {DIFFICULTIES.map((tier) => `${form.mix[tier]} ${tier}`).join(' · ')}
                </dd>
              </div>
              <div><dt>Pool</dt><dd>{plural(form.poolIds.length, 'questions')} from your own bank</dd></div>
              <div><dt>Scoring</dt><dd>{formatGrade(form.pointsPerQuestion)} points per question</dd></div>
              <div><dt>Time a student has</dt><dd>{form.durationMinutes} minutes</dd></div>
              <div>
                <dt>Open window</dt>
                <dd>{formatWindow(form.startLocal, form.endLocal)}</dd>
              </div>
              <div><dt>Target</dt><dd>{SCOPES.find((scope) => scope.value === form.targetScope)?.label}</dd></div>
            </dl>
            <p className="font-normal text-muted">
              {editing
                ? editOutcomeExplainer(loadedStatus)
                : 'Creating an exam sends it to an administrator for approval. It has no access code and students cannot start it until it is approved.'}
            </p>
          </Card>

          {!valid && (
            <ul className="m-0 grid gap-1 pl-5 font-normal text-muted">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!valid || saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create exam'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/doctor/exams')}>Cancel</Button>
            {saving && <span className="font-normal text-muted">Working — do not close this page.</span>}
          </div>
        </>
      )}
    </form>
  );
}

/** Guards the empty and half-typed cases: new Date('').toISOString() throws a RangeError, so a cleared
 *  datetime-local would take the whole review block down. */
function formatWindow(startLocal: string, endLocal: string): string {
  const start = localToIso(startLocal);
  const end = localToIso(endLocal);
  if (start === null || end === null) return '—';
  return `${formatDateTime(start)} to ${formatDateTime(end)}`;
}
