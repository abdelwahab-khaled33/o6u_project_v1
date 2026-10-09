/* eslint-disable react-hooks/set-state-in-effect -- the subject list and the combined matrix both come from the API and cannot be derived during render */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import { describeError, EmptyState, plural } from '../admin/adminShared';
import {
  buildExportPath,
  columnTypeLabel,
  exportFileName,
  exportScopeForColumn,
  formatGradeCell,
} from './resultsModel';
import type { CombinedResultsResponse, SubjectOption } from './resultsTypes';

type ListResponse = { subjects: SubjectOption[] };

const MATRIX_TABLE =
  'w-full border-collapse bg-white [&_tbody_tr:hover]:bg-[#f6f8fc] ' +
  '[&_td]:border-b [&_td]:border-[#eef1f7] [&_td]:px-4 [&_td]:py-3 [&_td]:text-left ' +
  '[&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:align-top [&_th]:text-[0.72rem] ' +
  '[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-[#5b6b8c] ' +
  '[&_th]:min-w-[170px] [&_th:first-child]:min-w-[48px] [&_th:nth-child(2)]:min-w-[190px]';

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
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

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

  // The first section opens, the rest stay collapsed, and switching subjects
  // re-opens the new first section. Search never forces anything open: a match
  // inside a collapsed section stays one click away rather than jumping.
  useEffect(() => {
    if (data) setOpenIds(new Set(data.sections.slice(0, 1).map((section) => section.section.id)));
  }, [data]);

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

  function toggleSection(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="grid max-w-[560px] gap-1.5">
          <h2>{data ? `${data.subject.code} results` : 'Subject results'}</h2>
          <p className="font-normal leading-relaxed text-muted">
            Every ended exam and quiz in this subject, one column each. A blank cell (—) means the student has no graded attempt there.
          </p>
        </div>
        {data && data.columns.length > 0 && (
          <Button
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void exportScope('all')}
          >
            <span aria-hidden="true" className="mr-[7px] inline-flex align-[-2px]">
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
        )}
      </div>

      {exportError && <Alert>{exportError}</Alert>}

      <div className="mt-5 grid gap-[18px]">
        <div className="flex flex-wrap items-end gap-3.5">
          <div className="w-full max-w-[300px]">
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
          </div>
          <div className="min-w-[240px] flex-1">
            <Field label="Search" htmlFor="subject-results-search">
              <span className="relative block [&_input]:w-full [&_input]:pr-[34px] [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:right-[11px] [&_svg]:top-1/2 [&_svg]:-translate-y-1/2 [&_svg]:text-muted">
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
                visibleSections.map((section) => {
                  const open = openIds.has(section.section.id);
                  if (!open) {
                    return (
                      <div
                        key={section.section.id}
                        className="flex flex-wrap items-center gap-x-2 rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-3.5 shadow-[0_4px_14px_rgb(36_52_80/7%)]"
                      >
                        <h3 className="font-bold text-primary-dark">
                          {section.section.name}{' '}
                          <span className="font-normal text-muted">
                            {section.ta.full_name} · {plural(section.students.length, 'students')}
                          </span>
                        </h3>
                        <Button variant="text" className="ms-auto" onClick={() => toggleSection(section.section.id)}>
                          <span aria-hidden="true">▸</span> Expand
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={section.section.id}
                      className="overflow-hidden rounded-[14px] border border-[#e3e8f2] bg-white shadow-[0_4px_14px_rgb(36_52_80/7%)]"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 px-5 pb-3 pt-4">
                        <h3 className="font-bold text-primary-dark">
                          {section.section.name}{' '}
                          <span className="font-normal text-muted">
                            {section.ta.full_name} · {plural(section.students.length, 'students')}
                          </span>
                        </h3>
                        <span className="ms-auto text-[0.8rem] font-normal text-muted">Scroll right for more columns →</span>
                        <Button variant="text" className="px-1.5 text-[0.8rem]" onClick={() => toggleSection(section.section.id)}>
                          <span aria-hidden="true">▾</span> Collapse
                        </Button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className={MATRIX_TABLE}>
                          <thead>
                            <tr>
                              <th>Sno</th>
                              <th>Student</th>
                              {data.columns.map((column) => (
                                <th key={column.id}>
                                  <div className="mb-1.5 text-[0.85rem] font-bold normal-case leading-snug text-primary-dark">
                                    {column.title}
                                  </div>
                                  <span className="mb-1.5 inline-block rounded-full bg-[#e8edf6] px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-primary-dark">
                                    {columnTypeLabel(column.type)} · {formatGradeCell(column.max_grade)} max
                                  </span>
                                  <div className="flex flex-wrap items-center gap-x-1.5 text-[0.82rem]">
                                    <Link className="font-semibold text-primary" to={`${detailsBase}/${column.id}`}>
                                      Open results
                                    </Link>
                                    <span aria-hidden="true" className="font-normal text-muted">·</span>
                                    <Button
                                      variant="text"
                                      className="px-1 py-0.5 text-[0.82rem]"
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
                                <td className="tabular-nums text-muted">{index + 1}</td>
                                <td>
                                  <div className="max-w-[460px] font-bold text-primary-dark [overflow-wrap:anywhere]">
                                    {student.student_name}
                                  </div>
                                  <span className="font-normal text-muted">{student.student_code ?? '—'}</span>
                                </td>
                                {data.columns.map((column) => (
                                  <td key={column.id} className="font-bold tabular-nums text-primary-dark">
                                    {formatGradeCell(student.grades[column.id] ?? null)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
