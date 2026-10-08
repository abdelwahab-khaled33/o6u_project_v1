import { useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { describeError, EmptyState } from './adminShared';

type ImportReport = Record<string, unknown>;

function scalarText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

function valuesInReport(report: ImportReport, pattern: RegExp) {
  const values: Array<[string, string | number]> = [];
  function visit(value: unknown, parent = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      const label = parent ? `${parent}.${key}` : key;
      if (pattern.test(key) && (typeof nested === 'number' || typeof nested === 'string')) values.push([label, nested]);
      else visit(nested, label);
    }
  }
  visit(report);
  return values;
}

function errorRowsInReport(report: ImportReport): unknown[] {
  const rows: unknown[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/error|invalid/i.test(key) && Array.isArray(nested)) rows.push(...(nested as unknown[]));
      else if (nested && typeof nested === 'object') visit(nested);
    }
  }
  visit(report);
  return rows;
}

function rowErrorLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const rowNumber = scalarText(row.row ?? row.row_number ?? row.rowNumber);
    const detail = scalarText(row.error ?? row.message ?? row.reason);
    if (rowNumber !== null && detail !== null) return `Row ${rowNumber}: ${detail}`;
    return Object.values(row).map(scalarText).filter((item): item is string => item !== null).join(' — ');
  }
  return scalarText(value) ?? '';
}

export function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setReport(await api.upload<ImportReport>('/admin/users/import/dry-run', body));
      setReportFile(file);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    if (!file || !report || reportFile !== file) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    const body = new FormData();
    body.append('file', file);
    try {
      setReport(await api.upload<ImportReport>('/admin/users/import/commit', body));
      setSuccess('Import completed.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  const counts = report ? valuesInReport(report, /total|valid|error|invalid/i) : [];
  const rowErrors = report ? errorRowsInReport(report) : [];

  return (
    <Card>
      <h2>Excel user import</h2>
      <p className="font-normal text-muted">Review the dry-run report before committing. Commit remains available only for the same file that was checked.</p>
      <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void dryRun(event); }}>
        <Field label="Excel file" htmlFor="user-import-file">
          <Input
            id="user-import-file"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReport(null); setReportFile(null); setSuccess(null); }}
            required
          />
        </Field>
        <div><Button type="submit" variant="secondary" disabled={!file || loading}>{loading ? 'Checking…' : 'Run dry run'}</Button></div>
      </form>
      <div className="mt-5 grid gap-[18px]">
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {loading && <div><Spinner label="Processing import" /> Processing import…</div>}
        {report && (
          <section>
            <h3>Dry-run report</h3>
            {counts.length > 0 ? (
              <ul>{counts.map(([key, value]) => <li key={key}>{key.replaceAll('_', ' ')}: {String(value)}</li>)}</ul>
            ) : (
              <p className="font-normal text-muted">No count fields were included in the response.</p>
            )}
            <h3>Row errors</h3>
            {rowErrors.length > 0 ? (
              <ul>{rowErrors.map((item, index) => <li key={`${index}-${rowErrorLabel(item)}`}>{rowErrorLabel(item)}</li>)}</ul>
            ) : (
              <EmptyState>No row errors reported.</EmptyState>
            )}
            {!success && (
              <Button onClick={() => { void commitImport(); }} disabled={loading || !file || reportFile !== file}>Commit import</Button>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
