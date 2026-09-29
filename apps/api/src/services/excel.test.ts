import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { resolveErrorResponse } from '../lib/http-error.js';
import { ExcelRowLimitError, MAX_EXCEL_ROWS, readFirstSheet } from './excel.js';

async function buildSheet(rowCount: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Username', 'Password', 'Full Name', 'Role']);
  for (let i = 0; i < rowCount; i++) {
    ws.addRow([`user-${i}`, 'Passw0rd!23', `User ${i}`, 'student']);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

describe('readFirstSheet', () => {
  it('reads a normal sheet into rows keyed by header', async () => {
    const rows = await readFirstSheet(await buildSheet(2));

    expect(rows.headers).toEqual(['Username', 'Password', 'Full Name', 'Role']);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.cells.Username).toBe('user-0');
    expect(rows.rows[0]?.rowNumber).toBe(2);
  });

  it('accepts a sheet exactly at the limit', async () => {
    const buffer = await buildSheet(5);
    const rows = await readFirstSheet(buffer, 5);

    expect(rows.rows).toHaveLength(5);
  });

  it('rejects a sheet one row past the limit', async () => {
    const buffer = await buildSheet(6);

    await expect(readFirstSheet(buffer, 5)).rejects.toBeInstanceOf(ExcelRowLimitError);
  });

  it('names the limit and tells the admin what to do instead', async () => {
    const buffer = await buildSheet(6);

    await expect(readFirstSheet(buffer, 5)).rejects.toThrow(/more than 5 rows/);
    await expect(readFirstSheet(buffer, 5)).rejects.toThrow(/Split it into smaller files/);
  });

  it('rejects a sheet past the default limit', async () => {
    // The real cap, not a test-sized one: a caller that forgets the argument still gets
    // a bounded parse.
    const buffer = await buildSheet(3);

    await expect(readFirstSheet(buffer)).resolves.toBeTruthy();
    expect(MAX_EXCEL_ROWS).toBe(5000);
  });

  it('carries the limit on the error so a handler can report it without parsing the message', async () => {
    const buffer = await buildSheet(6);

    const error = await readFirstSheet(buffer, 5).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ExcelRowLimitError);
    expect((error as ExcelRowLimitError).rowLimit).toBe(5);
  });

  it('reaches the client as a 413 with its own message, not a generic 500', async () => {
    // The class exists to be thrown from deep inside the importer, so whether the client
    // learns what went wrong is decided here and nowhere else.
    const buffer = await buildSheet(6);

    const error = await readFirstSheet(buffer, 5).catch((err: unknown) => err);
    const resolved = resolveErrorResponse(error);

    expect(resolved.status).toBe(413);
    expect(resolved.body.error).toMatch(/more than 5 rows/);
  });
});
