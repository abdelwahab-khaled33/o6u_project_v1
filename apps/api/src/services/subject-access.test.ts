import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    doctorAssignment: { count: vi.fn() },
    section: { count: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

import {
  NIL_UUID,
  buildScopedSectionWhere,
  buildScopedSubjectWhere,
  canManageBank,
  visibleRosterSubjectId,
} from './subject-access.js';

describe('buildScopedSubjectWhere', () => {
  it('lets an admin see every subject', () => {
    expect(buildScopedSubjectWhere('admin', 'admin-1')).toEqual({});
  });

  it('scopes a doctor to their own doctor assignments', () => {
    expect(buildScopedSubjectWhere('doctor', 'doctor-1')).toEqual({
      doctor_assignments: { some: { doctor_id: 'doctor-1' } },
    });
  });

  it('scopes a TA to the subjects where they teach a section', () => {
    expect(buildScopedSubjectWhere('ta', 'ta-1')).toEqual({
      sections: { some: { ta_id: 'ta-1' } },
    });
  });

  it('fails closed for a student instead of exposing the whole catalogue', () => {
    const where = buildScopedSubjectWhere('student', 'student-1');
    expect(where).not.toEqual({});
    expect(where).toEqual({ id: NIL_UUID });
  });

  it('never leaks one user id into another user filter', () => {
    expect(JSON.stringify(buildScopedSubjectWhere('doctor', 'doctor-1'))).not.toContain('doctor-2');
    expect(JSON.stringify(buildScopedSubjectWhere('ta', 'ta-1'))).not.toContain('ta-2');
  });
});

describe('buildScopedSubjectWhere agrees with canManageBank', () => {
  beforeEach(() => {
    prisma.doctorAssignment.count.mockReset();
    prisma.section.count.mockReset();
  });

  it('uses the same doctor assignment relation and id that canManageBank counts', async () => {
    prisma.doctorAssignment.count.mockResolvedValue(1);

    const allowed = await canManageBank('doctor-1', 'doctor', 'subject-1');
    const where = buildScopedSubjectWhere('doctor', 'doctor-1');

    expect(allowed).toBe(true);
    expect(prisma.doctorAssignment.count).toHaveBeenCalledWith({
      where: { doctor_id: 'doctor-1', subject_id: 'subject-1' },
    });
    expect(where).toEqual({ doctor_assignments: { some: { doctor_id: 'doctor-1' } } });
  });

  it('uses the same section relation and id that canManageBank counts', async () => {
    prisma.section.count.mockResolvedValue(1);

    const allowed = await canManageBank('ta-1', 'ta', 'subject-1');
    const where = buildScopedSubjectWhere('ta', 'ta-1');

    expect(allowed).toBe(true);
    expect(prisma.section.count).toHaveBeenCalledWith({
      where: { ta_id: 'ta-1', subject_id: 'subject-1' },
    });
    expect(where).toEqual({ sections: { some: { ta_id: 'ta-1' } } });
  });

  it('refuses an admin, because spec 9 grants question_bank.* to doctor and ta only', async () => {
    // The question-bank router is guarded by requirePermission('question_bank.manage'),
    // which no admin holds, so no admin can reach any canManageBank call site. This
    // assertion pins the fail-closed fallback for that dead path: if the router guard
    // is ever relaxed, an admin must still be refused by scope rather than silently
    // gaining question-bank access that spec 9 never granted.
    await expect(canManageBank('admin-1', 'admin', 'subject-1')).resolves.toBe(false);
    expect(prisma.doctorAssignment.count).not.toHaveBeenCalled();
    expect(prisma.section.count).not.toHaveBeenCalled();
  });

  it('still lets an admin list every subject, because listing has no spec 9 key', () => {
    // Deliberately different from canManageBank: GET /subjects is a scoped read with
    // no management key, so its "what you may see" and the bank's "what you may
    // manage" answer differently for admin. Read the two together, never as one.
    expect(buildScopedSubjectWhere('admin', 'admin-1')).toEqual({});
  });
});

describe('buildScopedSectionWhere', () => {
  it('lets an admin list every section, optionally within one subject', () => {
    expect(buildScopedSectionWhere('admin', 'admin-1')).toEqual({});
    expect(buildScopedSectionWhere('admin', 'admin-1', 'subject-1')).toEqual({
      subject_id: 'subject-1',
    });
  });

  it('scopes a doctor to sections in subjects they are assigned to', () => {
    expect(buildScopedSectionWhere('doctor', 'doctor-1')).toEqual({
      subject: { doctor_assignments: { some: { doctor_id: 'doctor-1' } } },
    });
  });

  it('scopes a TA to the sections they actually teach', () => {
    expect(buildScopedSectionWhere('ta', 'ta-1')).toEqual({ ta_id: 'ta-1' });
    expect(buildScopedSectionWhere('ta', 'ta-1', 'subject-1')).toEqual({
      subject_id: 'subject-1',
      ta_id: 'ta-1',
    });
  });

  it('fails closed for a student', () => {
    expect(buildScopedSectionWhere('student', 'student-1')).toEqual({ id: NIL_UUID });
    expect(buildScopedSectionWhere('student', 'student-1', 'subject-1')).toEqual({
      subject_id: 'subject-1',
      id: NIL_UUID,
    });
  });

  it('keeps the subject filter in place for every role, so it cannot widen access', () => {
    for (const role of ['admin', 'doctor', 'ta', 'student'] as const) {
      expect(buildScopedSectionWhere(role, 'user-1', 'subject-1')).toMatchObject({
        subject_id: 'subject-1',
      });
    }
  });

  it('agrees with canManageBank on the same ta_id, so a TA is only offered sections it may target', async () => {
    prisma.section.count.mockResolvedValue(1);

    await expect(canManageBank('ta-1', 'ta', 'subject-1')).resolves.toBe(true);
    expect(prisma.section.count).toHaveBeenCalledWith({
      where: { ta_id: 'ta-1', subject_id: 'subject-1' },
    });
    expect(buildScopedSectionWhere('ta', 'ta-1', 'subject-1')).toMatchObject({ ta_id: 'ta-1' });
  });
});

describe('visibleRosterSubjectId', () => {
  beforeEach(() => {
    prisma.doctorAssignment.count.mockReset().mockResolvedValue(0);
    prisma.section.count.mockReset().mockResolvedValue(0);
  });

  it('gives an admin the real subject without asking the database', async () => {
    await expect(visibleRosterSubjectId('admin', 'admin-1', 'subject-1')).resolves.toBe('subject-1');
    expect(prisma.doctorAssignment.count).not.toHaveBeenCalled();
    expect(prisma.section.count).not.toHaveBeenCalled();
  });

  it('gives a doctor their assigned subject', async () => {
    prisma.doctorAssignment.count.mockResolvedValue(1);

    await expect(visibleRosterSubjectId('doctor', 'doctor-1', 'subject-1')).resolves.toBe('subject-1');
    expect(prisma.doctorAssignment.count).toHaveBeenCalledWith({
      where: { doctor_id: 'doctor-1', subject_id: 'subject-1' },
    });
  });

  it('fails a doctor with no assignment closed, which is the leak this closes', async () => {
    prisma.doctorAssignment.count.mockResolvedValue(0);

    await expect(visibleRosterSubjectId('doctor', 'doctor-1', 'subject-1')).resolves.toBe(NIL_UUID);
  });

  it('gives a TA the subject where they teach, and only that one', async () => {
    prisma.section.count.mockResolvedValue(1);
    await expect(visibleRosterSubjectId('ta', 'ta-1', 'subject-1')).resolves.toBe('subject-1');

    prisma.section.count.mockResolvedValue(0);
    await expect(visibleRosterSubjectId('ta', 'ta-1', 'subject-2')).resolves.toBe(NIL_UUID);
  });

  it('fails closed for a student rather than relying on the role guard', async () => {
    await expect(visibleRosterSubjectId('student', 'student-1', 'subject-1')).resolves.toBe(NIL_UUID);
    expect(prisma.doctorAssignment.count).not.toHaveBeenCalled();
    expect(prisma.section.count).not.toHaveBeenCalled();
  });

  it('uses the predicates canManageBank already counts, so read and write scope cannot drift', async () => {
    prisma.doctorAssignment.count.mockResolvedValue(1);
    await expect(canManageBank('doctor-1', 'doctor', 'subject-1')).resolves.toBe(true);
    await expect(visibleRosterSubjectId('doctor', 'doctor-1', 'subject-1')).resolves.toBe('subject-1');

    prisma.doctorAssignment.count.mockReset().mockResolvedValue(0);
    await expect(canManageBank('doctor-1', 'doctor', 'subject-1')).resolves.toBe(false);
    await expect(visibleRosterSubjectId('doctor', 'doctor-1', 'subject-1')).resolves.toBe(NIL_UUID);
  });
});
