/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, type TermResetCounts } from './adminShared';

type PreviewResponse = { confirmation_phrase: string; counts: TermResetCounts };
type ResetResponse = { counts: TermResetCounts; warnings: string[] };

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

export function AdminTermResetPage() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<ResetResponse | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const data = await api.get<PreviewResponse>('/admin/term/reset');
      setPreview(data);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<ResetResponse>('/admin/term/reset', { confirmation });
      setResult(data);
      setConfirmation('');
      setLoading(true);
      await loadPreview();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setResetting(false);
    }
  }

  const phrase = preview?.confirmation_phrase ?? '';
  const matches = confirmation.trim() === phrase && phrase !== '';
  const counts = preview ? [...Object.entries(preview.counts)].sort((a, b) => b[1] - a[1]) : [];
  const max = Math.max(0, ...counts.map(([, count]) => count));
  const total = counts.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div>
      <div className="grid max-w-[560px] gap-1.5">
        <h2>Term reset</h2>
        <p className="font-normal leading-relaxed text-muted">Preview of what a reset would delete for this term.</p>
      </div>

      <div className="mt-5 grid gap-[18px]">
        {error && <Alert>{error}</Alert>}

        <p className="rounded-[10px] bg-[#fde7e5] px-4 py-3 text-[0.9rem] font-normal leading-relaxed text-[#8f1c13]">
          <strong className="font-bold">This cannot be undone.</strong> It deletes this term&rsquo;s exams, attempts, questions, sections, enrollments and non-admin accounts. Admin accounts, subjects and permission defaults are preserved.
        </p>

        {result && (
          <>
            <Alert variant="success">Term reset completed. The following records were deleted.</Alert>
            {result.warnings.length > 0 && (
              <Alert variant="info">
                <strong>Completed with warnings:</strong>
                <ul>
                  {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </Alert>
            )}
            <Table>
              <thead><tr><th>Record</th><th>Deleted</th></tr></thead>
              <tbody>
                {Object.entries(result.counts).map(([table, count]) => (
                  <tr key={table}><td className="font-mono text-[0.85rem]">{table}</td><td className="tabular-nums">{formatCount(count)}</td></tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        {loading ? (
          <div><Spinner label="Loading term reset preview" /> Loading preview…</div>
        ) : !preview ? (
          <p className="font-normal text-muted">The term reset preview is unavailable.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-[14px] border border-[#e3e8f2] bg-white shadow-[0_4px_14px_rgb(36_52_80/7%)]">
              <table className="w-full border-collapse bg-white [&_tbody_tr:hover]:bg-[#f6f8fc] [&_td]:border-b [&_td]:border-[#eef1f7] [&_td]:px-5 [&_td]:py-3 [&_td]:text-left [&_th]:bg-white [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:text-[0.72rem] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-[#5b6b8c]">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th><span className="sr-only">Share of records</span></th>
                    <th className="text-right">Would be deleted</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map(([table, count]) => {
                    const share = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <tr key={table}>
                        <td className={`font-mono text-[0.9rem] ${count === 0 ? 'text-[#9aa7c2]' : 'text-primary-dark'}`}>
                          {table}
                        </td>
                        <td>
                          <span aria-hidden="true" className="block h-2.5 min-w-[200px] rounded-full bg-[#e8edf3]">
                            {count > 0 && (
                              <span
                                className="block h-full rounded-full bg-accent"
                                style={{ width: `${share}%`, minWidth: '10px' }}
                              />
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-right font-bold tabular-nums text-primary-dark">
                          {formatCount(count)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="font-bold text-primary-dark">Total</td>
                    <td><span className="sr-only">Total of all records</span></td>
                    <td className="whitespace-nowrap text-right font-bold tabular-nums text-primary-dark">
                      {formatCount(total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <form className="grid gap-[18px] rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]" onSubmit={(event) => { void submit(event); }}>
              <div className="grid gap-1.5">
                <h2>Confirm the reset</h2>
                <p className="font-normal text-muted">
                  Type{' '}
                  <code className="rounded-[6px] bg-[#edf0f6] px-2 py-0.5 font-mono text-[0.85rem] font-bold text-primary-dark">
                    {phrase}
                  </code>{' '}
                  to enable the button.
                </p>
              </div>
              <div className="max-w-[400px]">
                <Field label="Confirmation phrase" htmlFor="term-reset-confirmation">
                  <Input
                    id="term-reset-confirmation"
                    name="confirmation"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="danger" disabled={!matches || resetting}>
                  {resetting ? 'Resetting…' : 'Reset the term'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
