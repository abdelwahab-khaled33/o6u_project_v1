import { describe, expect, it } from 'vitest';

import {
  cleanBanner,
  commitBlockedReason,
  importStep,
  reportCounts,
  reportErrorRows,
} from './adminImportModel';

describe('importStep', () => {
  it('is step 1 with no file, step 2 with a file but no report, step 3 with a report', () => {
    expect(importStep(false, false)).toBe(1);
    expect(importStep(true, false)).toBe(2);
    expect(importStep(true, true)).toBe(3);
    expect(importStep(false, true)).toBe(1);
  });
});

describe('reportCounts', () => {
  it('reads the dry-run counters', () => {
    expect(reportCounts({ total: 4, valid: 0, errorCount: 4, errors: [] })).toEqual({ total: 4, valid: 0, errors: 4 });
  });

  it('returns null when the counters are missing or unparseable', () => {
    expect(reportCounts(null)).toBeNull();
    expect(reportCounts({})).toBeNull();
    expect(reportCounts({ total: 'four', valid: 0, errorCount: 0 })).toBeNull();
  });
});

describe('reportErrorRows', () => {
  it('reads row/reason pairs and drops malformed entries', () => {
    expect(
      reportErrorRows({
        errors: [
          { row: 2, reason: 'Username already exists' },
          { row: 'x', reason: 'Bad row' },
          'plain string',
        ],
      }),
    ).toEqual([{ row: 2, reason: 'Username already exists' }]);
  });

  it('is empty without an errors array', () => {
    expect(reportErrorRows(null)).toEqual([]);
    expect(reportErrorRows({})).toEqual([]);
  });
});

describe('cleanBanner', () => {
  it('uses the singular sentence for exactly one valid row', () => {
    expect(cleanBanner(1)).toBe('No row errors reported. The one row in this file is valid and ready to import.');
  });

  it('uses the plural sentence otherwise', () => {
    expect(cleanBanner(5)).toBe('No row errors reported. The 5 rows in this file are valid and ready to import.');
  });
});

describe('commitBlockedReason', () => {
  it('blocks only when there are no valid rows', () => {
    expect(commitBlockedReason(0)).toBe('Nothing to commit while there are no valid rows.');
    expect(commitBlockedReason(3)).toBeNull();
  });
});
