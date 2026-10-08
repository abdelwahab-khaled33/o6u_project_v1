/* eslint-disable react-hooks/set-state-in-effect -- the shared bank is fetched from the API on mount and whenever the selected subject changes; the rows cannot be derived during render */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { DIFFICULTIES, QUESTION_TYPES } from '@exam/shared';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import { describeError, EmptyState, formatDateTime, plural, type Subject } from '../admin/adminShared';
import { formatGrade, QuestionForm, TYPE_LABELS, type BankQuestion } from '../doctor/DoctorQuestionForm';
import { authorLabel, canManageRow } from './taQuizModel';

type ImportReport = {
  total: number;
  valid: number;
  errorCount: number;
  errors: { row: number; reason: string }[];
};

const EXCEL_COLUMNS: { column: string; rule: string }[] = [
  { column: 'Question Text', rule: 'The question as it appears to students. Required.' },
  { column: 'Type', rule: 'Exactly mcq or true_false, in lowercase.' },
  { column: 'Options', rule: 'Multiple choice only: 2 to 8 options separated by a pipe character (|). Leave empty for true_false.' },
  { column: 'Correct Answer', rule: 'Verbatim. For mcq it must match one of the options exactly; for true_false it is true or false.' },
  { column: 'Grade', rule: 'A number greater than 0.' },
  { column: 'Difficulty', rule: 'Exactly easy, medium or hard, in lowercase.' },
  { column: 'Image Filename', rule: 'A reference only, not a working link. Filled in on export when a question has an image.' },
  { column: 'Author', rule: 'Written on export for traceability. The importer ignores it.' },
];

type MineFilter = 'all' | 'mine' | 'others';

function QuestionFilterBar({
  search,
  onSearch,
  type,
  onType,
  difficulty,
  onDifficulty,
  mine,
  onMine,
  onReset,
}: {
  search: string;
  onSearch: (value: string) => void;
  type: string;
  onType: (value: string) => void;
  difficulty: string;
  onDifficulty: (value: string) => void;
  mine: MineFilter;
  onMine: (value: MineFilter) => void;
  onReset: () => void;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]" onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}>
      <Field label="Search text" htmlFor="ta-bank-search">
        <Input
          id="ta-bank-search"
          value={search}
          placeholder="Question text or answer"
          onChange={(event) => onSearch(event.target.value)}
        />
      </Field>
      <Field label="Type" htmlFor="ta-bank-type-filter">
        <Select id="ta-bank-type-filter" value={type} onChange={(event) => onType(event.target.value)}>
          <option value="">All types</option>
          {QUESTION_TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}
        </Select>
      </Field>
      <Field label="Difficulty" htmlFor="ta-bank-difficulty-filter">
        <Select id="ta-bank-difficulty-filter" value={difficulty} onChange={(event) => onDifficulty(event.target.value)}>
          <option value="">All difficulties</option>
          {DIFFICULTIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </Field>
      <Field label="Author" htmlFor="ta-bank-mine-filter">
        <Select
          id="ta-bank-mine-filter"
          value={mine}
          onChange={(event) => onMine(event.target.value as MineFilter)}
        >
          <option value="all">Everyone</option>
          <option value="mine">Only mine</option>
          <option value="others">Only colleagues'</option>
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="text" onClick={onReset}>Clear filters</Button>
      </div>
    </form>
  );
}

function QuestionImportCard({ subject, onImported }: { subject: Subject | null; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(false);

  async function dryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setReport(null);
    setReportFile(null);
    const body = new FormData();
    body.append('file', file);
    try {
      setReport(await api.upload<ImportReport>('/question-bank/import/dry-run', body));
      setReportFile(file);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    // The reportFile guard is the point of a dry run: it makes committing a different file from the one
    // that was checked impossible, which is the mistake the commit is supposed to prevent.
    if (!file || !subject || !report || reportFile !== file) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    const body = new FormData();
    body.append('file', file);
    body.append('subject_id', subject.id);
    try {
      const result = await api.upload<ImportReport>('/question-bank/import/commit', body);
      setReport(result);
      setSuccess(
        `Imported ${plural(result.valid, 'questions')} into the shared bank for ${subject.code} — ${subject.name}. `
        + 'They are attributed to you, so you can edit and delete them. Reopen the bank to see them.',
      );
      onImported();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-5">
      <h2>Excel import</h2>
      <p className="font-normal text-muted">
        Bulk questions are text only. Check the dry run before committing, and commit only the same file you
        checked. Imported questions join the shared bank for the selected subject and are attributed to you.
      </p>

      <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void dryRun(event); }}>
        <Field label="Excel file" htmlFor="ta-question-import-file">
          <Input
            id="ta-question-import-file"
            type="file"
            accept=".xlsx,.xls"
            required
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setReportFile(null);
              setSuccess(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" disabled={!file || loading}>
            {loading ? 'Checking…' : 'Run dry run'}
          </Button>
          <Button type="button" variant="text" onClick={() => setShowFormat((current) => !current)}>
            {showFormat ? 'Hide expected format' : 'Show expected format'}
          </Button>
        </div>
      </form>

      <div className="mt-5 grid gap-[18px]">
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {loading && <div><Spinner label="Processing import" /> Processing import…</div>}

        {showFormat && (
          <section>
            <h3>Expected columns</h3>
            <Table>
              <thead><tr><th>Column</th><th>Rule</th></tr></thead>
              <tbody>
                {EXCEL_COLUMNS.map((entry) => (
                  <tr key={entry.column}>
                    <td>{entry.column}</td>
                    <td>{entry.rule}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="font-normal text-muted">
              Exporting writes exactly this format, so export, edit in Excel and re-import round-trips. Two limits are
              known: an option whose text contains a pipe character cannot survive the round trip, because the importer
              splits options on the pipe; and Image Filename is a reference only, so an exported bank keeps the text,
              options and answers of an imaged question but not a working image.
            </p>
          </section>
        )}

        {report && (
          <section>
            <h3>Dry-run report</h3>
            <ul>
              <li>Rows read: {report.total}</li>
              <li>Valid rows: {report.valid}</li>
              <li>Rows with errors: {report.errorCount}</li>
            </ul>
            <h4>Row errors</h4>
            {report.errors.length > 0 ? (
              <ul>
                {report.errors.map((rowError) => (
                  <li key={`${rowError.row}-${rowError.reason}`}>Row {rowError.row}: {rowError.reason}</li>
                ))}
              </ul>
            ) : (
              <EmptyState>No row errors reported.</EmptyState>
            )}
            {!success && (
              <Button
                onClick={() => { void commitImport(); }}
                disabled={loading || !file || !subject || reportFile !== file}
              >
                {subject ? `Commit import to ${subject.code}` : 'Commit import'}
              </Button>
            )}
            {!subject && <p className="font-normal text-muted">Select a subject above before committing, because questions are filed per subject.</p>}
          </section>
        )}
      </div>
    </Card>
  );
}

export function TaQuestionBankPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [mineFilter, setMineFilter] = useState<MineFilter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadSubjects = useCallback(async () => {
    try {
      const result = await api.get<{ subjects: Subject[] }>('/subjects');
      setSubjects(result.subjects);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingSubjects(false);
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    if (!subjectId) {
      setQuestions([]);
      return;
    }
    setLoadingQuestions(true);
    try {
      const result = await api.get<{ questions: BankQuestion[] }>(
        `/question-bank?subject_id=${encodeURIComponent(subjectId)}`,
      );
      setQuestions(result.questions);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingQuestions(false);
    }
  }, [subjectId]);

  useEffect(() => { void loadSubjects(); }, [loadSubjects]);
  useEffect(() => { void loadQuestions(); }, [loadQuestions]);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === subjectId),
    [subjects, subjectId],
  );

  const visibleQuestions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return questions.filter((question) => {
      if (typeFilter && question.question_type !== typeFilter) return false;
      if (difficultyFilter && question.difficulty !== difficultyFilter) return false;
      // is_mine is the server's own authorship answer, not a comparison of author.id with the
      // signed-in user, so this filter cannot disagree with what PATCH and DELETE will allow.
      if (mineFilter === 'mine' && question.is_mine !== true) return false;
      if (mineFilter === 'others' && question.is_mine === true) return false;
      if (needle === '') return true;
      return question.text.toLowerCase().includes(needle)
        || question.correct_answer.toLowerCase().includes(needle)
        || question.options.some((option) => option.toLowerCase().includes(needle));
    });
  }, [questions, search, typeFilter, difficultyFilter, mineFilter]);

  const mineCount = useMemo(
    () => questions.filter((question) => question.is_mine === true).length,
    [questions],
  );

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  async function handleSaved(message: string) {
    setNotice(message);
    closeForm();
    await loadQuestions();
  }

  async function deleteQuestion(question: BankQuestion) {
    setBusyId(question.id);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/question-bank/${question.id}`);
      setNotice(`Deleted question: ${question.text.slice(0, 60)}${question.text.length > 60 ? '…' : ''}`);
      setConfirmDelete(null);
      setEditing(null);
      await loadQuestions();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function exportBank() {
    if (!selectedSubject) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const blob = await api.download(`/question-bank/export?subject_id=${encodeURIComponent(selectedSubject.id)}`);
      saveBlob(blob, `shared-bank-${selectedSubject.code.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
      setNotice(`Exported the shared bank for ${selectedSubject.code} — ${selectedSubject.name}, with an author column.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <Card>
        <h2>Shared question bank</h2>
        <p className="font-normal text-muted">
          The bank is shared per subject: every TA who teaches a section of that subject sees these questions, and
          each row shows who wrote it. You can edit and delete only the questions you added yourself — that limit is
          decided by the server, and the buttons below follow it rather than re-checking anything in the browser.
        </p>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        <div className="mt-5 grid gap-[18px]">
          {loadingSubjects ? (
            <div><Spinner label="Loading subjects" /> Loading subjects…</div>
          ) : subjects.length === 0 ? (
            <EmptyState>
              You do not teach a section in any subject yet, so there is no shared bank to open. An administrator
              assigns TAs to sections; once one is assigned, its subject appears here.
            </EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <Field label="Subject" htmlFor="ta-bank-subject">
                  <Select
                    id="ta-bank-subject"
                    value={subjectId}
                    onChange={(event) => {
                      setSubjectId(event.target.value);
                      closeForm();
                      setConfirmDelete(null);
                    }}
                  >
                    <option value="" disabled>Select a subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={!selectedSubject || exporting}
                    onClick={() => { void exportBank(); }}
                  >
                    {exporting ? 'Exporting…' : 'Export this bank'}
                  </Button>
                </div>
              </div>

              {selectedSubject && (
                <p className="font-normal text-muted">
                  Showing {plural(visibleQuestions.length, 'questions')} of {questions.length} in{' '}
                  {selectedSubject.code} — {selectedSubject.name}. {plural(mineCount, 'questions')} of them{' '}
                  {mineCount === 1 ? 'is' : 'are'} yours to edit.
                </p>
              )}

              {!selectedSubject ? (
                <EmptyState>Select a subject to open its shared question bank.</EmptyState>
              ) : (
                <>
                  {(creating || editing) && (
                    <Card className="mt-2 border-t-4 border-t-accent">
                      <QuestionForm
                        key={editing ? editing.id : 'new'}
                        subject={selectedSubject}
                        question={editing}
                        onSaved={(message) => { void handleSaved(message); }}
                        onCancel={closeForm}
                      />
                    </Card>
                  )}

                  {!creating && !editing && (
                    <div><Button onClick={() => { setCreating(true); setConfirmDelete(null); }}>Add question</Button></div>
                  )}

                  <QuestionFilterBar
                    search={search}
                    onSearch={setSearch}
                    type={typeFilter}
                    onType={setTypeFilter}
                    difficulty={difficultyFilter}
                    onDifficulty={setDifficultyFilter}
                    mine={mineFilter}
                    onMine={setMineFilter}
                    onReset={() => {
                      setSearch('');
                      setTypeFilter('');
                      setDifficultyFilter('');
                      setMineFilter('all');
                    }}
                  />

                  {loadingQuestions ? (
                    <div><Spinner label="Loading questions" /> Loading questions…</div>
                  ) : visibleQuestions.length === 0 ? (
                    <EmptyState>
                      {questions.length === 0
                        ? 'This subject has no shared questions yet. Add one by hand, or use the Excel import below.'
                        : 'No questions match these filters.'}
                    </EmptyState>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Author</th>
                          <th>Type</th>
                          <th>Difficulty</th>
                          <th>Grade</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleQuestions.map((question) => {
                          const manageable = canManageRow(question);
                          return (
                            <tr key={question.id}>
                              <td>
                                <div className="max-w-[460px] [overflow-wrap:anywhere]">{question.text}</div>
                                {question.question_type === 'mcq' ? (
                                  <ul className="grid gap-[3px] pl-5 font-normal text-muted">
                                    {question.options.map((option, index) => (
                                      <li
                                        key={`${index}-${option}`}
                                        className={option === question.correct_answer ? 'font-bold text-[#147a47]' : undefined}
                                      >
                                        {option} — {option === question.correct_answer ? 'correct' : `option ${index + 1}`}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="font-normal text-muted">Correct answer: {question.correct_answer === 'true' ? 'True' : 'False'}</p>
                                )}
                                {question.image_url && (
                                  <img className="max-w-[160px] rounded-md border border-[#dfe5f0] bg-white" src={question.image_url} alt="Attached question" />
                                )}
                              </td>
                              <td>
                                <div>{authorLabel(question)}</div>
                                <div className="font-normal text-muted">{question.is_mine === true ? 'yours' : 'a colleague\'s'}</div>
                              </td>
                              <td>{TYPE_LABELS[question.question_type]}</td>
                              <td>{question.difficulty}</td>
                              <td>{formatGrade(question.grade)}</td>
                              <td>{formatDateTime(question.created_at)}</td>
                              <td>
                                {manageable ? (
                                  <div className="table-actions flex flex-wrap items-center gap-2">
                                    <Button
                                      variant="secondary"
                                      onClick={() => { setCreating(false); setEditing(question); setConfirmDelete(null); }}
                                    >
                                      Edit
                                    </Button>
                                    {confirmDelete === question.id ? (
                                      <>
                                        <span className="font-normal text-muted">Delete this question?</span>
                                        <Button
                                          variant="danger"
                                          disabled={busyId === question.id}
                                          onClick={() => { void deleteQuestion(question); }}
                                        >
                                          {busyId === question.id ? 'Deleting…' : 'Confirm delete'}
                                        </Button>
                                        <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                                      </>
                                    ) : (
                                      <Button variant="danger" onClick={() => { setEditing(null); setConfirmDelete(question.id); }}>
                                        Delete
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="font-normal text-muted">Read only — written by {authorLabel(question)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </Card>

      <QuestionImportCard
        subject={selectedSubject ?? null}
        onImported={() => { void loadQuestions(); }}
      />
    </div>
  );
}
