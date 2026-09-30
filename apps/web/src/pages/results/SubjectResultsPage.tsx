/* eslint-disable react-hooks/set-state-in-effect -- the subject list and the combined matrix both come from the API and cannot be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import { describeError, EmptyState } from '../admin/adminShared';
import {
  buildExportPath,
  columnTypeLabel,
  exportFileName,
  exportScopeForColumn,
  formatGradeCell,
} from './resultsModel';
import type { CombinedResultsResponse, SubjectOption } from './resultsTypes';

type ListResponse = { subjects: SubjectOption[] };

export function SubjectResultsPage({ detailsBase }: { detailsBase: string }) {
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [data, setData] = useState<CombinedResultsResponse | null>(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    setLoadingSubjects(true);
    try {
      const result = await api.get<ListResponse>('/subjects');
      setSubjects(result.subjects);
      setSubjectId((current) => current !== '' ? current : (result.subjects[0]?.id ?? ''));
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingSubjects(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const loadCombined = useCallback(async (id: string) => {
    if (id === '') return;
    setLoadingData(true);
    try {
      setData(await api.get<CombinedResultsResponse>(`/results/subjects/${id}`));
      setError(null);
    } catch (caught) {
      setData(null);
      setError(describeError(caught));
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (subjectId !== '') void loadCombined(subjectId);
  }, [subjectId, loadCombined]);

  const needle = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!data) return [];
    if (needle === '') return data.sections;
    return data.sections
      .map((section) => ({
        ...section,
        students: section.students.filter((student) =>
          [student.student_name, student.student_code ?? ''].some((value) =>
            value.toLowerCase().includes(needle),
          ),
        ),
      }))
      .filter((section) => section.students.length > 0);
  }, [data, needle]);

  async function exportScope(scope: string) {
    if (!data) return;
    setExporting(scope);
    setExportError(null);
    try {
      const blob = await api.download(buildExportPath(data.subject.id, scope));
      saveBlob(blob, exportFileName(data.subject.code, scope));
    } catch (caught) {
      setExportError(describeError(caught));
    } finally {
      setExporting(null);
    }
  }

  return (
    <Card>
      <div className="results-head">
        <div>
          <h2>{data ? `${data.subject.code} results` : 'Subject results'}</h2>
          <p className="page-intro">
            Every ended exam and quiz in this subject, one column each. Grades are read from the column each
            cell belongs to, so a blank cell means that student has no graded attempt there.
          </p>
        </div>
        {data && data.columns.length > 0 && (
          <div className="row-actions">
            <Button
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void exportScope('all')}
            >
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
              {exporting === 'all' ? 'Exporting…' : 'Export all'}
            </Button>
          </div>
        )}
      </div>

      {exportError && <Alert>{exportError}</Alert>}

      <div className="form-stack">
        <div className="results-toolbar">
          <Field label="Subject" htmlFor="subject-results-subject">
            <Select
              id="subject-results-subject"
              value={subjectId}
              disabled={loadingSubjects || subjects.length === 0}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setQuery('');
              }}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code} — {subject.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search" htmlFor="subject-results-search">
            <span className="search-wrap">
              <Input
                id="subject-results-search"
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
        </div>

        {loadingSubjects ? (
          <div>
            <Spinner label="Loading subjects" /> Loading subjects…
          </div>
        ) : subjects.length === 0 ? (
          <EmptyState>There are no subjects to show here.</EmptyState>
        ) : loadingData ? (
          <div>
            <Spinner label="Loading results" /> Loading results…
          </div>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : (
          data && (
            <>
              {data.columns.length === 0 ? (
                <EmptyState>No ended exam or quiz in this subject has results yet.</EmptyState>
              ) : visibleSections.length === 0 ? (
                <EmptyState>No students match this search.</EmptyState>
              ) : (
                visibleSections.map((section) => (
                  <section key={section.section.id} aria-label={section.section.name}>
                    <h3>
                      {section.section.name} <span className="muted">· {section.ta.full_name}</span>
                    </h3>
                    <div className="matrix-scroll">
                      <Table>
                        <thead>
                          <tr>
                            <th>Sno</th>
                            <th>Student</th>
                            {data.columns.map((column) => (
                              <th key={column.id}>
                                <div className="column-title">{column.title}</div>
                                <div className="muted">
                                  {columnTypeLabel(column.type)} · {formatGradeCell(column.max_grade)} max ·{' '}
                                  {column.owner.full_name}
                                </div>
                                <div className="row-actions">
                                  <Link to={`${detailsBase}/${column.id}`}>Open results</Link>
                                  <Button
                                    variant="text"
                                    disabled={exporting !== null}
                                    title={`Export ${column.title} as a spreadsheet`}
                                    onClick={() => void exportScope(exportScopeForColumn(column))}
                                  >
                                    {exporting === exportScopeForColumn(column) ? 'Exporting…' : 'Export'}
                                  </Button>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.students.map((student, index) => (
                            <tr key={student.student_id}>
                              <td>{index + 1}</td>
                              <td>
                                <div className="question-text">{student.student_name}</div>
                                <span className="muted">{student.student_code ?? '—'}</span>
                              </td>
                              {data.columns.map((column) => (
                                <td key={column.id} className="grade-cell">
                                  {formatGradeCell(student.grades[column.id] ?? null)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </section>
                ))
              )}
              <p className="muted">
                Grades come back as numbers and are shown as they are. A blank cell means no graded attempt
                for that student in that column.
              </p>
            </>
          )
        )}
      </div>
    </Card>
  );
}
