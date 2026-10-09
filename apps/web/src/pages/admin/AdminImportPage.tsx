import { useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { describeError } from './adminShared';
import {
  cleanBanner,
  commitBlockedReason,
  importStep,
  reportCounts,
  reportErrorRows,
  type ImportReportLike,
} from './adminImportModel';

const STEP_LABELS = ['Choose file', 'Dry run', 'Commit'];

function CircleStepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of 3: ${STEP_LABELS[step - 1]}`}>
      {STEP_LABELS.map((label, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        const done = number < step;
        const active = number === step;
        return (
          <div key={label} className={`flex items-center gap-2 ${index > 0 ? 'flex-1' : ''}`}>
            {index > 0 && <span aria-hidden="true" className={`h-px flex-1 ${done || active ? 'bg-primary' : 'bg-[#dfe5f0]'}`} />}
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[0.85rem] font-bold ${
                done ? 'bg-primary text-white' : active ? 'bg-accent text-[#1a2148]' : 'border border-[#c4cede] bg-white text-muted'
              }`}
            >
              {done ? '✓' : number}
            </span>
            <span className={`whitespace-nowrap text-[0.9rem] ${active || done ? 'font-bold text-primary-dark' : 'font-normal text-muted'}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function fileTag(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toUpperCase() : '';
  return ext === 'XLSX' || ext === 'XLS' ? ext : 'XLSX';
}

export function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReportLike>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const counts = reportCounts(report);
  const rowErrors = reportErrorRows(report);
  const hasErrors = counts !== null && counts.errors > 0;
  const step = importStep(file !== null, report !== null);

  function pickFile(next: File | null) {
    setFile(next);
    setReport(null);
    setReportFile(null);
    setSuccess(null);
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function runDryRun() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setReport(null);
    setReportFile(null);
    const body = new FormData();
    body.append('file', file);
    try {
      setReport(await api.upload<ImportReportLike>('/admin/users/import/dry-run', body));
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
      setReport(await api.upload<ImportReportLike>('/admin/users/import/commit', body));
      setSuccess('Import completed.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  const blocked = counts ? commitBlockedReason(counts.valid) : null;

  return (
    <div>
      <h2>Excel user import</h2>
      <p className="max-w-[560px] font-normal leading-relaxed text-muted">
        Review the dry-run report before committing. Commit stays available only for the same file that was checked.
      </p>

      <div className="mt-5 grid gap-[18px]">
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div className="rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
          <CircleStepper step={step} />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          aria-label="Excel file"
          onChange={(event) => { pickFile(event.target.files?.[0] ?? null); event.target.value = ''; }}
        />

        {counts === null ? (
          <div className="grid gap-4 rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
            {file === null ? (
              <div
                className={`grid justify-items-center gap-2 rounded-[12px] border border-dashed px-6 py-9 text-center ${dragging ? 'border-primary bg-[#eef3fb]' : 'border-[#b9c4d8]'}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); pickFile(event.dataTransfer.files?.[0] ?? null); }}
              >
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fdebd7] text-[1.3rem] font-bold text-[#8a4a12]">
                  ↑
                </span>
                <p className="text-[1.05rem] font-bold text-primary-dark">Choose an Excel file</p>
                <p className="font-normal text-muted">Drag a .xlsx file here, or browse your computer. Nothing is created until you commit.</p>
                <Button type="button" onClick={openPicker}>Choose file</Button>
              </div>
            ) : (
              <div>
                <p className="mb-2 text-[0.85rem] font-semibold text-primary-dark">Excel file</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-[#f2f5fa] px-3 py-2">
                    <span className="flex-none rounded bg-[#e0e7f3] px-1.5 py-0.5 text-[0.7rem] font-bold text-primary-dark">{fileTag(file.name)}</span>
                    <span className="truncate text-[0.9rem] font-semibold text-primary-dark">{file.name}</span>
                  </span>
                  <Button type="button" variant="secondary" onClick={openPicker}>Choose another file</Button>
                  <Button type="button" disabled={loading} onClick={() => { void runDryRun(); }}>
                    {loading ? 'Checking…' : 'Run dry run'}
                  </Button>
                </div>
              </div>
            )}
            {file === null && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" disabled>Run dry run</Button>
                <span className="font-normal text-muted">Choose a file to enable the dry run.</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-2 rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
              <p className="text-[0.85rem] font-semibold text-primary-dark">Excel file</p>
              <div className="flex flex-wrap items-center gap-2">
                {file !== null && (
                  <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-[#f2f5fa] px-3 py-2">
                    <span className="flex-none rounded bg-[#e0e7f3] px-1.5 py-0.5 text-[0.7rem] font-bold text-primary-dark">{fileTag(file.name)}</span>
                    <span className="truncate text-[0.9rem] font-semibold text-primary-dark">{file.name}</span>
                  </span>
                )}
                <Button type="button" variant="secondary" onClick={openPicker}>Choose another file</Button>
                <Button
                  type="button"
                  disabled={loading || file === null}
                  onClick={() => { void runDryRun(); }}
                >
                  {loading ? 'Checking…' : 'Run dry run'}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <p className="text-[0.82rem] font-normal text-muted">Total rows</p>
                <p className="text-[1.5rem] font-extrabold tabular-nums text-primary-dark">{counts.total}</p>
              </div>
              <div className="rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <p className="text-[0.82rem] font-normal text-muted">Valid</p>
                <p className="text-[1.5rem] font-extrabold tabular-nums text-[#1f7a33]">{counts.valid}</p>
              </div>
              <div className="rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <p className="text-[0.82rem] font-normal text-muted">Errors</p>
                <p className={`text-[1.5rem] font-extrabold tabular-nums ${counts.errors > 0 ? 'text-[#b42318]' : 'text-primary-dark'}`}>
                  {counts.errors}
                </p>
              </div>
            </div>

            {loading && <div><Spinner label="Processing import" /> Processing import…</div>}

            {hasErrors ? (
              <div className="overflow-x-auto rounded-[14px] border border-[#e3e8f2] bg-white shadow-[0_4px_14px_rgb(36_52_80/7%)]">
                <table className="w-full border-collapse bg-white [&_td]:border-b [&_td]:border-[#eef1f7] [&_td]:px-5 [&_td]:py-3.5 [&_td]:text-left [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:text-[0.72rem] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-[#5b6b8c]">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowErrors.map((item) => (
                      <tr key={`row-${item.row}`}>
                        <td className="whitespace-nowrap font-mono text-[0.85rem] text-primary-dark">Row {item.row}</td>
                        <td>
                          <p className="font-bold text-primary-dark">{item.reason}</p>
                          <p className="text-[0.85rem] font-normal text-muted">Remove the row to keep the existing account unchanged.</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-[10px] bg-[#e3f4e8] px-4 py-3 text-[0.9rem] font-semibold text-[#14532d]">
                {cleanBanner(counts.valid)}
              </p>
            )}

            {!success && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={loading || file === null || reportFile !== file || blocked !== null}
                  onClick={() => { void commitImport(); }}
                >
                  Commit import
                </Button>
                <span className="font-normal text-muted">
                  {blocked ?? 'Commit applies only to this checked file. Choosing another file needs a new dry run.'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
