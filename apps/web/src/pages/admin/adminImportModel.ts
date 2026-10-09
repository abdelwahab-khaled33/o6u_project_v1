export type ImportReportLike = Record<string, unknown> | null | undefined;

export type ImportCounts = { total: number; valid: number; errors: number };

export type ImportErrorRow = { row: number; reason: string };

function toCount(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function importStep(hasFile: boolean, hasReport: boolean): 1 | 2 | 3 {
  if (!hasFile) return 1;
  return hasReport ? 3 : 2;
}

export function reportCounts(report: ImportReportLike): ImportCounts | null {
  if (!report || typeof report !== 'object') return null;
  const total = toCount(report.total);
  const valid = toCount(report.valid);
  const errors = toCount(report.errorCount);
  if (total === null || valid === null || errors === null) return null;
  return { total, valid, errors };
}

export function reportErrorRows(report: ImportReportLike): ImportErrorRow[] {
  if (!report || typeof report !== 'object' || !Array.isArray(report.errors)) return [];
  const rows: ImportErrorRow[] = [];
  for (const entry of report.errors) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const row = record.row;
    const reason = record.reason;
    if (typeof row === 'number' && Number.isFinite(row) && typeof reason === 'string' && reason !== '') {
      rows.push({ row, reason });
    }
  }
  return rows;
}

export function cleanBanner(valid: number): string {
  if (valid === 1) return 'No row errors reported. The one row in this file is valid and ready to import.';
  return `No row errors reported. The ${valid} rows in this file are valid and ready to import.`;
}

export function commitBlockedReason(valid: number): string | null {
  if (valid === 0) return 'Nothing to commit while there are no valid rows.';
  return null;
}
