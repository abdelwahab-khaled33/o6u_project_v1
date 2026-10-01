import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, readFirstSheet } = vi.hoisted(() => {
  const readFirstSheet = vi.fn();
  const models = {
    user: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    subject: { findMany: vi.fn() },
    enrollment: { findMany: vi.fn(), create: vi.fn() },
    sectionMembership: { create: vi.fn(), deleteMany: vi.fn() },
    doctorAssignment: { findMany: vi.fn(), create: vi.fn() },
    section: { findMany: vi.fn(), upsert: vi.fn() },
    excelImportLog: { create: vi.fn() },
  };
  // The commit is one transaction over the whole file. The transaction client is the same
  // object here, so an assertion about what was written sees tx calls too -- which is the
  // only way "nothing was written" can be asserted at all.
  const prisma = {
    ...models,
    $transaction: vi.fn(async (fn: (tx: typeof models) => Promise<unknown>) => fn(models)),
  };
  return { prisma, readFirstSheet };
});

const SEC_ID = 'sec-1';
const SEC_NAME = 'Live Section A';

const sectionsRow = (over: Record<string, unknown> = {}) => ({
  id: SEC_ID,
  name: SEC_NAME,
  subject_id: SUBJECT_ID,
  ...over,
});

vi.mock('../lib/prisma.js', () => ({ prisma }));
vi.mock('./excel.js', () => ({ readFirstSheet }));

import { commitUserImport, dryRunUserImport } from './users-import.js';

const SUBJECT_ID = 'sub-1';

const row = (cells: Record<string, string>, rowNumber = 2) => ({ cells, rowNumber });

const sheet = (rows: { cells: Record<string, string>; rowNumber: number }[]) =>
  readFirstSheet.mockResolvedValue({ headers: [], rows });

const student = (over: Record<string, string> = {}) => ({
  Username: 'stu-1',
  Password: 'Passw0rd!23',
  'Full Name': 'Student One',
  Role: 'student',
  'Student Code': 'S81342',
  Subjects: 'CS81143',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.subject.findMany.mockResolvedValue([{ id: SUBJECT_ID, code: 'CS81143' }]);
  prisma.section.findMany.mockResolvedValue([sectionsRow()]);
  prisma.user.upsert.mockResolvedValue({ id: 'user-1' });
  prisma.user.create.mockResolvedValue({ id: 'user-1' });
  prisma.user.findMany.mockResolvedValue([]);
  prisma.enrollment.findMany.mockResolvedValue([]);
  prisma.doctorAssignment.findMany.mockResolvedValue([]);
  prisma.excelImportLog.create.mockResolvedValue({});
});

describe('password minimum', () => {
  // Every other password entry point in the app enforces 8..72. An import that accepts 6
  // is a way to create an account weaker than the policy, and 72 is bcrypt's real limit
  // -- a longer password is silently truncated to its first 72 bytes.
  it('rejects a 6-character password that the import used to accept', async () => {
    sheet([row(student({ Password: 'abc123' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/8/);
  });

  it('rejects a 7-character password', async () => {
    sheet([row(student({ Password: 'abc1234' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.errorCount).toBe(1);
  });

  it('accepts an 8-character password', async () => {
    sheet([row(student({ Password: 'abcd1234' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(1);
    expect(report.errorCount).toBe(0);
  });

  it('rejects a password longer than bcrypt supports', async () => {
    sheet([row(student({ Password: 'a'.repeat(73) }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/72/);
  });
});

describe('the dry run reports accounts that already exist', () => {
  // The commit is an upsert, so a file naming an existing account silently overwrites its
  // role, resets its password and reactivates it. Nothing about the dry run -- the step the
  // admin is meant to read before committing -- said so.
  it('flags an existing username as an error in the dry run', async () => {
    prisma.user.findMany.mockResolvedValue([{ username: 'stu-1' }]);
    sheet([row(student())]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/already exists/i);
  });

  it('matches case-insensitively, as the unique index would', async () => {
    prisma.user.findMany.mockResolvedValue([{ username: 'STU-1' }]);
    sheet([row(student())]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
  });

  it('leaves an unused username alone', async () => {
    prisma.user.findMany.mockResolvedValue([{ username: 'someone-else' }]);
    sheet([row(student())]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(1);
  });
});

describe('the commit never overwrites an existing account', () => {
  it('creates a row for a new user rather than upserting', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    sheet([row(student())]);

    await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('still reports the existing-username row as an error and writes nothing for it', async () => {
    prisma.user.findMany.mockResolvedValue([{ username: 'stu-1' }]);
    sheet([row(student())]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(report.valid).toBe(0);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('never writes a role, password or activation state over an existing account', async () => {
    // Defence in depth: even if the dry run is skipped, the write path carries no branch
    // that can express "overwrite an existing user".
    prisma.user.findMany.mockResolvedValue([{ username: 'stu-1' }]);
    sheet([row(student())]);

    await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    const updates = prisma.user.update.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(updates.join('\n')).not.toMatch(/password_hash/);
    expect(updates.join('\n')).not.toMatch(/"role"/);
  });
});

describe('the commit is all or nothing', () => {
  it('writes nothing at all when any row is invalid', async () => {
    // Row-level transactions meant a failure on row 40 left rows 1..39 committed with no
    // way to undo them and an import log that records the whole thing as done.
    sheet([
      row(student({ Username: 'stu-1' }), 2),
      row(student({ Username: 'stu-2', Subjects: 'NOPE99' }), 3),
    ]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(report.errorCount).toBe(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.excelImportLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the whole file when it contains a duplicate username', async () => {
    sheet([
      row(student({ Username: 'stu-1' }), 2),
      row(student({ Username: 'stu-1' }), 3),
    ]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    // The first row is individually fine; the second is the problem. The commit still
    // refuses all of them, which is the whole point of the single transaction.
    expect(report.valid).toBe(1);
    expect(report.errorCount).toBe(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('commits a clean file in one transaction and logs it', async () => {
    sheet([row(student()), row(student({ Username: 'stu-2' }), 3)]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(report.valid).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
    expect(prisma.excelImportLog.create).toHaveBeenCalledTimes(1);
  });

  it('records zero errors in the log for a clean file', async () => {
    sheet([row(student())]);

    await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    const log = prisma.excelImportLog.create.mock.calls.at(-1)![0] as {
      data: { error_count: number; imported_count: number };
    };
    expect(log.data.error_count).toBe(0);
    expect(log.data.imported_count).toBe(1);
  });

  it('creates a student with can_change_password false, per the spec', async () => {
    sheet([row(student())]);

    await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    const created = prisma.user.create.mock.calls.at(-1)![0] as {
      data: { can_change_password: boolean; student_code: string | null };
    };
    expect(created.data.can_change_password).toBe(false);
    expect(created.data.student_code).toBe('S81342');
  });

  it('creates a TA with can_change_password true and a null student code', async () => {
    sheet([row({ ...student(), Role: 'ta', 'Student Code': '', Sections: 'CS81143:Live Section A' })]);

    await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    const created = prisma.user.create.mock.calls.at(-1)![0] as {
      data: { can_change_password: boolean; student_code: string | null };
    };
    expect(created.data.can_change_password).toBe(true);
    expect(created.data.student_code).toBeNull();
  });
});

describe('student sections in the import', () => {
  // The Sections column used to be TA-only: a student row carrying one imported exactly like
  // a row without it, silently dropping where the student sits. From here a student row may
  // name one section per subject, and the dry run is where a bad one is refused.
  it('accepts a student naming one section per subject', async () => {
    sheet([row(student({ Sections: 'CS81143:Live Section A' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(1);
    expect(report.errorCount).toBe(0);
  });

  it('still accepts a student with no sections, exactly like before', async () => {
    sheet([row(student())]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(1);
    expect(report.errorCount).toBe(0);
  });

  it('refuses a section that does not exist in that subject', async () => {
    sheet([row(student({ Sections: 'CS81143:No Such Section' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/No Such Section/);
  });

  it('refuses a Sections entry for a subject the row does not list', async () => {
    prisma.subject.findMany.mockResolvedValue([
      { id: SUBJECT_ID, code: 'CS81143' },
      { id: 'sub-2', code: 'SEC4938' },
    ]);
    sheet([row(student({ Subjects: 'CS81143', Sections: 'SEC4938:Live Section A' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/SEC4938/);
  });

  it('refuses two sections for one subject: a student sits in exactly one', async () => {
    sheet([row(student({ Sections: 'CS81143:Live Section A, Live Section B' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
    expect(report.errorCount).toBe(1);
  });

  it('refuses an ambiguous section name shared by two sections of the subject', async () => {
    prisma.section.findMany.mockResolvedValue([
      sectionsRow({ id: 'sec-1' }),
      sectionsRow({ id: 'sec-2' }),
    ]);
    sheet([row(student({ Sections: 'CS81143:Live Section A' }))]);

    const report = await dryRunUserImport(Buffer.from('x'));

    expect(report.valid).toBe(0);
    expect(report.errorCount).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/ambiguous/i);
  });

  it('writes the membership on commit and clears the same-subject siblings', async () => {
    sheet([row(student({ Sections: 'CS81143:Live Section A' }))]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(report.errorCount).toBe(0);
    expect(prisma.sectionMembership.create).toHaveBeenCalledTimes(1);
    const created = prisma.sectionMembership.create.mock.calls.at(-1)![0] as {
      data: { student_id: string; section_id: string };
    };
    expect(created.data).toEqual({ student_id: 'user-1', section_id: SEC_ID });
    const cleared = prisma.sectionMembership.deleteMany.mock.calls.at(-1)![0] as {
      where: { student_id: string; section: { subject_id: string } };
    };
    expect(cleared.where.student_id).toBe('user-1');
    expect(cleared.where.section.subject_id).toBe(SUBJECT_ID);
  });

  it('writes no membership on commit when the row names no section', async () => {
    sheet([row(student())]);

    const report = await commitUserImport(Buffer.from('x'), 'admin-1', 'users.xlsx');

    expect(report.errorCount).toBe(0);
    expect(prisma.sectionMembership.create).not.toHaveBeenCalled();
  });
});
