/* eslint-disable react-hooks/set-state-in-effect -- the subjects, the shared bank, the section roster and the quiz being edited are all fetched from the API; none of them can be derived during render */
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
import { formatGrade, type BankQuestion } from '../doctor/DoctorQuestionForm';
import { pointsValue, type ExamDetail } from '../doctor/doctorExamTypes';
import { archivedPoolProblem } from '../doctor/examWizardModel';
import {
  buildQuizPayload,
  DURATION_MAX,
  isoToLocal,
  localToIso,
  POINTS_DECIMALS,
  POINTS_MAX,
  POINTS_MIN,
  QUIZ_SOURCES,
  quizStatusNotice,
  rosterStudentsForSections,
  taQuizProblems,
  targetScopeOptions,
  TITLE_MAX,
  type QuizForm,
  type QuizSource,
  type RosterSection,
  type RosterStudent,
} from './taQuizModel';

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

function emptyForm(subjectId: string): QuizForm {
  return {
    subjectId,
    title: '',
    poolIds: [],
    mix: { easy: 0, medium: 0, hard: 0 },
    pointsPerQuestion: '1',
    durationMinutes: '20',
    startLocal: defaultStartLocal(),
    endLocal: defaultEndLocal(),
    quizSource: 'shared_bank',
    // A TA cannot target a whole subject, so sections is the only defensible opening value.
    targetScope: 'sections',
    targetSectionIds: [],
    targetStudentIds: [],
  };
}

function formFromQuiz(quiz: ExamDetail): QuizForm {
  return {
    subjectId: quiz.subject_id,
    title: quiz.title,
    poolIds: quiz.pool_questions.map((link) => link.question_id),
    mix: {
      easy: quiz.difficulty_mix.easy ?? 0,
      medium: quiz.difficulty_mix.medium ?? 0,
      hard: quiz.difficulty_mix.hard ?? 0,
    },
    pointsPerQuestion: String(pointsValue(quiz.points_per_question)),
    durationMinutes: String(quiz.duration_minutes),
    startLocal: isoToLocal(quiz.start_time),
    endLocal: isoToLocal(quiz.end_time),
    quizSource: quiz.quiz_source === 'own_questions' ? 'own_questions' : 'shared_bank',
    targetScope: quiz.target_scope === 'student_list' ? 'student_list' : 'sections',
    targetSectionIds: quiz.target_sections.map((row) => row.section_id),
    targetStudentIds: quiz.target_students.map((row) => row.student_id),
  };
}

function Coverage({ tier, required, selected, available }: {
  tier: Difficulty;
  required: number;
  selected: number;
  available: number;
}) {
  const enough = required === 0 || selected >= required;
  return (
    <div className="coverage" key={tier}>
      <div className="coverage-head">
        <span className="coverage-tier">{tier}</span>
        <span className={enough ? 'coverage-count' : 'coverage-count is-short'}>
          {selected} selected of {required} required
        </span>
      </div>
      <div className="coverage-bar" aria-hidden="true">
        <div
          className={enough ? 'coverage-fill' : 'coverage-fill is-short'}
          style={{ width: `${required === 0 ? 100 : Math.min(100, (selected / required) * 100)}%` }}
        />
      </div>
      <span className="muted">{available} in this bank at this difficulty</span>
    </div>
  );
}

export function TaQuizWizard({ quizId }: { quizId?: string }) {
  const editing = quizId !== undefined;
  const navigate = useNavigate();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [sections, setSections] = useState<RosterSection[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [form, setForm] = useState<QuizForm>(() => emptyForm(''));
  const [archivedPool, setArchivedPool] = useState<{ id: string; text: string; difficulty: Difficulty }[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | ''>('');
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingQuiz, setLoadingQuiz] = useState(editing);
  const [loadingBank, setLoadingBank] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
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

  useEffect(() => { if (!editing || quizId === undefined) return; void (async () => {
    setLoadingQuiz(true);
    try {
      const quiz = (await api.get<{ exam: ExamDetail }>(`/exams/${quizId}`)).exam;
      setForm(formFromQuiz(quiz));
      // The shared bank never contains archived rows, so the archived pool comes from the detail
      // response, which carries is_archived per pool question.
      setArchivedPool(
        quiz.pool_questions
          .filter((link) => link.question.is_archived === true)
          .map((link) => ({ id: link.question_id, text: link.question.text, difficulty: link.question.difficulty })),
      );
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingQuiz(false);
    }
  })(); }, [editing, quizId]);

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

  /** The roster is the two new subject-scoped endpoints, not the admin user and section lists, which are
   *  admin-only and used to make sections and student_list unreachable for a TA. */
  const loadRoster = useCallback(async (subjectId: string) => {
    if (subjectId === '') {
      setSections([]);
      setRoster([]);
      return;
    }
    setLoadingRoster(true);
    try {
      const [sectionResult, studentResult] = await Promise.all([
        api.get<{ sections: RosterSection[] }>(`/subjects/${encodeURIComponent(subjectId)}/sections`),
        api.get<{ students: RosterStudent[] }>(`/subjects/${encodeURIComponent(subjectId)}/students`),
      ]);
      setSections(sectionResult.sections);
      setRoster(studentResult.students);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  useEffect(() => { void loadBank(form.subjectId); }, [loadBank, form.subjectId]);
  useEffect(() => { void loadRoster(form.subjectId); }, [loadRoster, form.subjectId]);

  const selected = useMemo(() => new Set(form.poolIds), [form.poolIds]);
  // poolIds keeps archived ids by design: dropping them silently would hide state the server still
  // holds, so they stay selected and render below as a stated problem until removed.
  const archivedIds = useMemo(() => archivedPool.map((question) => question.id), [archivedPool]);
  const selectedArchived = useMemo(
    () => archivedPool.filter((question) => selected.has(question.id)),
    [archivedPool, selected],
  );
  const archivedIdSet = useMemo(() => new Set(archivedIds), [archivedIds]);
  const problems = taQuizProblems(form, bank, { sections, students: roster }, { archivedIds });
  const valid = problems.length === 0;

  /** With own_questions the server refuses a pool it did not author, so a question the TA did not write is
   *  unselectable rather than merely warned about. The predicate is the server's is_mine. */
  const pickable = useMemo(
    () => (form.quizSource === 'own_questions' ? bank.filter((question) => question.is_mine === true) : bank),
    [bank, form.quizSource],
  );

  const bankByDifficulty = useMemo(() => {
    const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const question of pickable) counts[question.difficulty] += 1;
    return counts;
  }, [pickable]);

  const selectedByDifficulty = useMemo(() => {
    const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const question of pickable) {
      if (selected.has(question.id)) counts[question.difficulty] += 1;
    }
    return counts;
  }, [pickable, selected]);

  const visibleBank = useMemo(
    () => (difficultyFilter === '' ? pickable : pickable.filter((question) => question.difficulty === difficultyFilter)),
    [pickable, difficultyFilter],
  );

  const eligibleStudents = useMemo(
    () => (form.targetScope === 'student_list' ? rosterStudentsForSections(roster, form.targetSectionIds) : roster),
    [roster, form.targetSectionIds, form.targetScope],
  );

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === form.subjectId) ?? null,
    [subjects, form.subjectId],
  );

  function patch(changes: Partial<QuizForm>) {
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

  /** Switching to own_questions can leave a question selected that the new source forbids, so the pool is
   *  trimmed in the same tick rather than being left to fail on submit. Archived selections are kept
   *  as a stated problem instead of being counted as authorship drops: they are unusable under either
   *  source, and dropping them here would report the wrong cause. */
  function setQuizSource(quizSource: QuizSource) {
    if (quizSource !== 'own_questions') {
      patch({ quizSource });
      return;
    }
    const keptMine = form.poolIds.filter((id) => bank.find((question) => question.id === id)?.is_mine === true);
    const keptArchived = form.poolIds.filter((id) => archivedIdSet.has(id));
    const kept = [...new Set([...keptMine, ...keptArchived])];
    const dropped = form.poolIds.length - kept.length;
    patch({
      quizSource,
      poolIds: kept,
      mix: dropped > 0 ? { easy: 0, medium: 0, hard: 0 } : form.mix,
    });
  }

  function toggleSection(id: string) {
    const next = form.targetSectionIds.includes(id)
      ? form.targetSectionIds.filter((each) => each !== id)
      : [...form.targetSectionIds, id];
    // Switching to sections must not carry a student selection that belonged to the student list.
    patch({
      targetSectionIds: next,
      targetStudentIds: form.targetScope === 'student_list' ? form.targetStudentIds : [],
    });
  }

  function toggleStudent(id: string) {
    patch({
      targetStudentIds: form.targetStudentIds.includes(id)
        ? form.targetStudentIds.filter((each) => each !== id)
        : [...form.targetStudentIds, id],
    });
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const payload = buildQuizPayload(form, { includeSubject: !editing });
    try {
      if (editing && quizId !== undefined) {
        const saved = await api.patch<{ exam: { status: string } }>(`/exams/${quizId}`, payload);
        void navigate('/ta/quizzes', {
          state: { notice: quizStatusNotice(payload.title, { editing: true, status: saved.exam.status }) },
        });
      } else {
        const created = await api.post<{ exam: { status: string } }>('/exams', payload);
        // The status is read back rather than asserted, and the sentence is chosen by `editing`, not by it:
        // a TA quiz is always created approved, so branching on the status reported "Updated" on create.
        void navigate('/ta/quizzes', {
          state: { notice: quizStatusNotice(payload.title, { editing: false, status: created.exam.status }) },
        });
      }
    } catch (caught) {
      setError(describeError(caught));
      setSaving(false);
    }
  }

  if (loadingSubjects || loadingQuiz) {
    return <div><Spinner label="Loading the quiz" /> Loading…</div>;
  }

  return (
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Alert>{error}</Alert>}

      {subjects.length === 0 ? (
        <Card>
          <h2>{editing ? 'Edit quiz' : 'New quiz'}</h2>
          <EmptyState>
            You do not teach a section in any subject yet, so there is nothing to build a quiz from. An
            administrator assigns TAs to sections; once one is assigned, the subject appears here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <div className="step-head">
              <h2><span className="step-number">1</span> Subject, title and source</h2>
            </div>
            <div className="form-stack">
              <Field label="Subject" htmlFor="ta-wizard-subject">
                <Select
                  id="ta-wizard-subject"
                  value={form.subjectId}
                  disabled={editing}
                  onChange={(event) => patch({
                    subjectId: event.target.value,
                    poolIds: [],
                    mix: { easy: 0, medium: 0, hard: 0 },
                    targetSectionIds: [],
                    targetStudentIds: [],
                  })}
                >
                  <option value="" disabled>Select a subject</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>
                  ))}
                </Select>
              </Field>
              {editing && (
                <p className="muted">
                  The subject is fixed: a quiz cannot move between subjects, because its questions, its targets and
                  its generated attempts all belong to the subject it was created in.
                </p>
              )}
              <Field label="Title" htmlFor="ta-wizard-title">
                <Input
                  id="ta-wizard-title"
                  value={form.title}
                  maxLength={TITLE_MAX + 20}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="Week 3 quiz"
                  required
                />
              </Field>
              <span className="muted">Between 2 and {TITLE_MAX} characters. Students see this title.</span>

              <fieldset className="fieldset-reset">
                <legend className="muted">Where the questions come from</legend>
                {QUIZ_SOURCES.map((source) => (
                  <label
                    className="scope-row"
                    key={source.value}
                    htmlFor={`ta-wizard-source-${source.value}`}
                  >
                    <input
                      id={`ta-wizard-source-${source.value}`}
                      type="radio"
                      name="quiz_source"
                      value={source.value}
                      checked={form.quizSource === source.value}
                      onChange={() => setQuizSource(source.value)}
                    />
                    <span>
                      {source.label}
                      <span className="muted"> — {source.hint}</span>
                    </span>
                  </label>
                ))}
                {form.quizSource === 'own_questions' && (
                  <p className="muted">
                    Only your own questions can be chosen, and the ones a colleague wrote are listed greyed out below.
                    The server enforces exactly this, so an unselectable question is a statement about authorship, not
                    a guess made in the browser.
                  </p>
                )}
              </fieldset>
            </div>
          </Card>

          <Card>
            <div className="step-head">
              <h2><span className="step-number">2</span> Question pool and difficulty mix</h2>
            </div>
            <p className="page-intro">
              The pool is the set of questions the quiz draws from. Each student is then given their own sample
              matching the mix you set here, with the questions and their options in a different order for every
              student.
            </p>

            <div className="form-stack">
              <fieldset className="fieldset-reset">
                <legend className="muted">How many questions of each difficulty should each student answer?</legend>
                <div className="mix-row">
                  {DIFFICULTIES.map((tier) => (
                    <Field key={tier} label={tier} htmlFor={`ta-wizard-mix-${tier}`}>
                      <Input
                        id={`ta-wizard-mix-${tier}`}
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
                <div className="coverage-row">
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
                  <p className="muted">
                    {archivedPoolProblem(selectedArchived.length)} The counts above count only
                    questions that can still be used.
                  </p>
                )}
              </fieldset>

              <div className="filter-bar">
                <Field label="Show" htmlFor="ta-wizard-bank-difficulty">
                  <Select
                    id="ta-wizard-bank-difficulty"
                    value={difficultyFilter}
                    onChange={(event) => setDifficultyFilter(event.target.value as Difficulty | '')}
                  >
                    <option value="">All difficulties</option>
                    {DIFFICULTIES.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
                  </Select>
                </Field>
                <div className="row-actions">
                  <Button type="button" variant="secondary" onClick={selectVisible} disabled={visibleBank.length === 0}>
                    Select all shown
                  </Button>
                  <Button type="button" variant="text" onClick={() => patch({ poolIds: [] })} disabled={form.poolIds.length === 0}>
                    Clear selection
                  </Button>
                </div>
              </div>

              {selectedArchived.length > 0 && (
                <fieldset className="fieldset-reset">
                  <legend className="muted">
                    {selectedArchived.length === 1
                      ? '1 question in your pool can no longer be used'
                      : `${selectedArchived.length} questions in your pool can no longer be used`}
                  </legend>
                  <ul className="pick-list">
                    {selectedArchived.map((question) => (
                      <li key={question.id}>
                        <div className="checkbox-row">
                          <input
                            id={`ta-wizard-archived-${question.id}`}
                            type="checkbox"
                            checked={false}
                            disabled
                            aria-disabled="true"
                          />
                          <span className="pick-meta">{question.difficulty}</span>
                          <span className="question-text">{question.text}</span>
                        </div>
                        <p className="muted">
                          This question was deleted (archived) and cannot be used in a quiz.
                          Saving is blocked until it is removed. The server refuses it with
                          “Some pool questions were not found or are archived”.
                        </p>
                        <div className="row-actions">
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
                <div><Spinner label="Loading the shared bank" /> Loading the shared bank…</div>
              ) : !selectedSubject ? (
                <EmptyState>Choose a subject above to pick questions from its shared bank.</EmptyState>
              ) : bank.length === 0 ? (
                <EmptyState>
                  {`The shared bank for ${selectedSubject.code} is empty. Add questions in the question bank first.`}
                </EmptyState>
              ) : pickable.length === 0 ? (
                <EmptyState>
                  {`You have not added any questions of your own to ${selectedSubject.code} yet, so "only my questions" has nothing to draw on. Add some, or switch the source back to the shared bank.`}
                </EmptyState>
              ) : visibleBank.length === 0 ? (
                <EmptyState>No questions at that difficulty. Choose a different filter.</EmptyState>
              ) : (
                <fieldset className="fieldset-reset">
                  <legend className="muted">
                    {form.poolIds.length} of {pickable.length} questions in the pool
                  </legend>
                  <ul className="pick-list">
                    {visibleBank.map((question) => (
                      <li key={question.id}>
                        <label className="checkbox-row" htmlFor={`ta-wizard-pick-${question.id}`}>
                          <input
                            id={`ta-wizard-pick-${question.id}`}
                            type="checkbox"
                            checked={selected.has(question.id)}
                            onChange={() => toggleQuestion(question.id)}
                          />
                          <span className="pick-meta">{question.difficulty}</span>
                          <span className="question-text">{question.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              {form.quizSource === 'own_questions' && bank.length > pickable.length && (
                <p className="muted">
                  {plural(bank.length - pickable.length, 'questions')} in this bank{' '}
                  {bank.length - pickable.length === 1 ? 'was' : 'were'} written by a colleague and cannot be used
                  while the source is set to your own questions.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="step-head">
              <h2><span className="step-number">3</span> Schedule and scoring</h2>
            </div>
            <div className="form-stack">
              <div className="mix-row">
                <Field label="Starts" htmlFor="ta-wizard-start">
                  <Input
                    id="ta-wizard-start"
                    type="datetime-local"
                    value={form.startLocal}
                    onChange={(event) => patch({ startLocal: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Ends" htmlFor="ta-wizard-end">
                  <Input
                    id="ta-wizard-end"
                    type="datetime-local"
                    value={form.endLocal}
                    onChange={(event) => patch({ endLocal: event.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="mix-row">
                <Field label="Minutes a student has" htmlFor="ta-wizard-duration">
                  <Input
                    id="ta-wizard-duration"
                    type="number"
                    min="1"
                    max={DURATION_MAX}
                    step="1"
                    value={form.durationMinutes}
                    onChange={(event) => patch({ durationMinutes: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Points per question" htmlFor="ta-wizard-points">
                  <Input
                    id="ta-wizard-points"
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
              <p className="muted">
                A student's deadline is the earlier of their own start plus these minutes, and the end time above, so
                a student who begins late does not gain extra time. This value is the whole score of the quiz: the
                grade stored with each question is not used for scoring. It is kept with {POINTS_DECIMALS} decimal
                places, between {POINTS_MIN} and {POINTS_MAX}, because that is all the score column can store — anything
                smaller would silently become zero.
              </p>
            </div>
          </Card>

          <Card>
            <div className="step-head">
              <h2><span className="step-number">4</span> Who takes it</h2>
            </div>
            <div className="form-stack">
              <fieldset className="fieldset-reset">
                <legend className="muted">Target</legend>
                {targetScopeOptions().map((scope) => (
                  <label className="scope-row" key={scope.value} htmlFor={`ta-wizard-scope-${scope.value}`}>
                    <input
                      id={`ta-wizard-scope-${scope.value}`}
                      type="radio"
                      name="ta_target_scope"
                      value={scope.value}
                      checked={form.targetScope === scope.value}
                      onChange={() => patch({
                        targetScope: scope.value,
                        targetStudentIds: scope.value === 'sections' ? [] : form.targetStudentIds,
                      })}
                    />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="muted">
                A quiz cannot target a whole subject. Attempts are generated for your own sections, or for the
                students you pick, and the sections and students below come from your own enrolment in this subject.
              </p>

              {loadingRoster ? (
                <div><Spinner label="Loading your sections" /> Loading your sections…</div>
              ) : !selectedSubject ? (
                <EmptyState>Choose a subject above to see the sections you teach.</EmptyState>
              ) : sections.length === 0 ? (
                <EmptyState>
                  {`You teach no section in ${selectedSubject.code}, so there is nobody to target. An administrator assigns TAs to sections.`}
                </EmptyState>
              ) : (
                <fieldset className="fieldset-reset">
                  <legend className="muted">Your sections in {selectedSubject.code}</legend>
                  <ul className="pick-list">
                    {sections.map((section) => (
                      <li key={section.id}>
                        <label className="checkbox-row" htmlFor={`ta-wizard-section-${section.id}`}>
                          <input
                            id={`ta-wizard-section-${section.id}`}
                            type="checkbox"
                            checked={form.targetSectionIds.includes(section.id)}
                            onChange={() => toggleSection(section.id)}
                          />
                          <span className="question-text">{section.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              {form.targetScope === 'student_list' && sections.length > 0 && (
                <fieldset className="fieldset-reset">
                  <legend className="muted">
                    {form.targetSectionIds.length === 0
                      ? 'Pick your sections above, or choose from every student you teach in this subject'
                      : 'Students in the sections you picked'}
                  </legend>
                  {eligibleStudents.length === 0 ? (
                    <EmptyState>
                      No student in the sections you picked. Clear a section above, or pick a section that has
                      students in it.
                    </EmptyState>
                  ) : (
                    <ul className="pick-list">
                      {eligibleStudents.map((student) => (
                        <li key={student.id}>
                          <label className="checkbox-row" htmlFor={`ta-wizard-student-${student.id}`}>
                            <input
                              id={`ta-wizard-student-${student.id}`}
                              type="checkbox"
                              checked={form.targetStudentIds.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                            />
                            <span className="question-text">
                              {student.full_name} — {student.student_code ?? 'no code'} · {student.section_name}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              )}
            </div>
          </Card>

          <Card className="detail-card">
            <div className="step-head">
              <h2><span className="step-number">5</span> Review</h2>
            </div>
            <dl className="review-list">
              <div><dt>Title</dt><dd>{form.title.trim() === '' ? '—' : form.title.trim()}</dd></div>
              <div><dt>Subject</dt><dd>{selectedSubject ? `${selectedSubject.code} — ${selectedSubject.name}` : '—'}</dd></div>
              <div>
                <dt>Questions from</dt>
                <dd>{QUIZ_SOURCES.find((source) => source.value === form.quizSource)?.label}</dd>
              </div>
              <div>
                <dt>Each student answers</dt>
                <dd>{DIFFICULTIES.map((tier) => `${form.mix[tier]} ${tier}`).join(' · ')}</dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd>
                  {plural(form.poolIds.length, 'questions')}
                  {form.quizSource === 'own_questions' ? ' you wrote' : ' from the shared bank'}
                </dd>
              </div>
              <div><dt>Scoring</dt><dd>{formatGrade(form.pointsPerQuestion)} points per question</dd></div>
              <div><dt>Time a student has</dt><dd>{form.durationMinutes} minutes</dd></div>
              <div>
                <dt>Open window</dt>
                <dd>{formatWindow(form.startLocal, form.endLocal)}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>
                  {form.targetScope === 'sections'
                    ? plural(form.targetSectionIds.length, 'sections')
                    : plural(form.targetStudentIds.length, 'students')}
                </dd>
              </div>
            </dl>
            <p className="muted">
              {editing
                ? 'Saving keeps the quiz live, leaves its access code alone, and clears the attempts already generated for it so every target is re-sampled from the pool you just saved.'
                : 'A quiz needs no administrator: it is live the moment it is created, and students reach it with the access code you can read on the quizzes page.'}
            </p>
          </Card>

          {!valid && (
            <ul className="requirement-list">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}

          <div className="row-actions">
            <Button type="submit" disabled={!valid || saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create quiz'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/ta/quizzes')}>Cancel</Button>
            {saving && <span className="muted">Working — do not close this page.</span>}
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
