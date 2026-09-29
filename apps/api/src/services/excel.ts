import ExcelJS from 'exceljs';

export interface ExcelRow {
  cells: Record<string, string>;
  rowNumber: number;
}

export class ExcelRowLimitError extends Error {
  readonly rowLimit: number;
  // Carried so resolveErrorResponse answers 413 with this message instead of collapsing
  // the whole thing to a generic 500, which would read as a server fault and tell the
  // admin nothing about what to change.
  readonly statusCode: number;

  constructor(rowLimit: number) {
    super(
      `This sheet has more than ${rowLimit} rows. Split it into smaller files and import ` +
        'each one, then repeat the dry run for the next file.',
    );
    this.name = 'ExcelRowLimitError';
    this.rowLimit = rowLimit;
    this.statusCode = 413;
  }
}

/**
 * A hard ceiling on rows read from one sheet.
 *
 * A .xlsx is a zip of XML, so a few megabytes of upload can describe millions of rows, and
 * every one of them becomes a JS object here. Without a cap the parse itself is the
 * denial-of-service: a single authenticated upload exhausts memory before a single row is
 * validated. 5000 matches the project's stated enrollment target, so a legitimate full-roll
 * file still imports in one go.
 */
export const MAX_EXCEL_ROWS = 5000;

/**
 * Read the first worksheet of an XLSX/XLS buffer into typed rows keyed by header.
 * Returns rows in document order; skips empty rows. Numeric cells are coerced to strings.
 * Throws ExcelRowLimitError past MAX_EXCEL_ROWS rather than materialising the sheet.
 */
export async function readFirstSheet(
  buffer: Buffer,
  maxRows: number = MAX_EXCEL_ROWS,
): Promise<{ headers: string[]; rows: ExcelRow[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.worksheets[0];
  if (!ws) {
    return { headers: [], rows: [] };
  }

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const val = cell.text?.trim();
    headers[colNumber - 1] = val || `column_${colNumber}`;
  });

  const rows: ExcelRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    // The cap has to live here rather than on ws.rowCount: after wb.xlsx.load, rowCount is
    // 0 for these sheets, so a dimension-based pre-check never fires and would be dead code
    // that reads as protection. Throwing from inside eachRow stops materialising the sheet.
    if (rows.length >= maxRows) {
      throw new ExcelRowLimitError(maxRows);
    }
    const cells: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        cells[header] = String(cell.text ?? '').trim();
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ cells, rowNumber });
    }
  });

  return { headers, rows };
}