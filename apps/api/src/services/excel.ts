import ExcelJS from 'exceljs';

export interface ExcelRow {
  cells: Record<string, string>;
  rowNumber: number;
}

/**
 * Read the first worksheet of an XLSX/XLS buffer into typed rows keyed by header.
 * Returns rows in document order; skips empty rows. Numeric cells are coerced to strings.
 */
export async function readFirstSheet(
  buffer: Buffer,
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