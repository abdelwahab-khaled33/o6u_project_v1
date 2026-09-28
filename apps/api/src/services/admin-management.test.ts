import { describe, it, expect, vi } from 'vitest';
import { PERMISSION_KEYS, ROLES } from '@exam/shared';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    permission: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    userPermissionOverride: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    sectionMembership: { count: vi.fn() },
    examTargetSection: { count: vi.fn() },
    section: { count: vi.fn() },
    question: { count: vi.fn() },
    exam: { count: vi.fn() },
    enrollment: { count: vi.fn() },
    doctorAssignment: { count: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

import {
  SELF_LOCKOUT_ERROR,
  buildUserWhere,
  canChangePasswordForCreate,
  canChangePasswordForPatch,
  getRolePermissionMatrix,
  getUserPermissionRows,
  isPermissionKey,
  isRole,
  resolvePaging,
  selfLockoutError,
  validateDoctorAssignment,
  validateEnrollment,
} from './admin-management.js';

describe('buildUserWhere', () => {
  it('returns an empty filter when nothing is requested', () => {
    expect(buildUserWhere({})).toEqual({});
  });

  it('keeps the role filter and ignores an unknown role', () => {
    expect(buildUserWhere({ role: 'ta' })).toEqual({ role: 'ta' });
    expect(buildUserWhere({ role: 'wizard' })).toEqual({});
  });

  it('searches username, full_name and student_code case-insensitively', () => {
    const where = buildUserWhere({ search: '  ahmed ' });
    expect(where.OR).toEqual([
      { username: { contains: 'ahmed', mode: 'insensitive' } },
      { full_name: { contains: 'ahmed', mode: 'insensitive' } },
      { student_code: { contains: 'ahmed', mode: 'insensitive' } },
    ]);
    expect(where.AND).toBeUndefined();
  });

  it('matches a subject by enrollment OR by membership in one of its sections', () => {
    const where = buildUserWhere({ subject_id: 'subject-1' });
    expect(where.AND).toEqual([
      {
        OR: [
          { enrollments: { some: { subject_id: 'subject-1' } } },
          { section_memberships: { some: { section: { subject_id: 'subject-1' } } } },
        ],
      },
    ]);
  });

  it('matches a section by membership only', () => {
    expect(buildUserWhere({ section_id: 'section-1' })).toEqual({
      AND: [{ section_memberships: { some: { section_id: 'section-1' } } }],
    });
  });

  it('ANDs the relational filters together and keeps search separate from them', () => {
    const where = buildUserWhere({ subject_id: 'subject-1', section_id: 'section-1', search: 'ali' });
    expect(where.AND).toHaveLength(2);
    expect(where.OR).toHaveLength(3);
  });
});

describe('resolvePaging', () => {
  it('returns null when page or page_size is missing so unpaged callers keep every row', () => {
    expect(resolvePaging(undefined, 20)).toBeNull();
    expect(resolvePaging(2, undefined)).toBeNull();
    expect(resolvePaging(undefined, undefined)).toBeNull();
  });

  it('converts page and page_size into skip and take', () => {
    expect(resolvePaging(3, 25)).toEqual({ page: 3, page_size: 25, skip: 50, take: 25 });
  });

  it('clamps page_size to 1..200 and page to at least 1', () => {
    expect(resolvePaging(0, 5000)).toEqual({ page: 1, page_size: 200, skip: 0, take: 200 });
    expect(resolvePaging(-4, 0)).toEqual({ page: 1, page_size: 1, skip: 0, take: 1 });
  });
});

describe('can_change_password invariant', () => {
  it('forces false for a student even when the body asks for true', () => {
    expect(canChangePasswordForCreate('student', true)).toBe(false);
    expect(canChangePasswordForPatch('student', true)).toBe(false);
  });

  it('defaults staff to true and otherwise leaves the requested value alone', () => {
    expect(canChangePasswordForCreate('ta', undefined)).toBe(true);
    expect(canChangePasswordForCreate('ta', false)).toBe(false);
    expect(canChangePasswordForPatch('doctor', true)).toBe(true);
  });

  it('leaves the field untouched on patch when a staff member does not mention it', () => {
    expect(canChangePasswordForPatch('admin', undefined)).toBeUndefined();
  });
});

describe('validateEnrollment', () => {
  it('accepts a student and a section of the requested subject', () => {
    const result = validateEnrollment({
      student: { id: 'student-1', role: 'student' },
      section: { id: 'section-1', subject_id: 'subject-1' },
      subjectId: 'subject-1',
    });
    expect(result).toBeNull();
  });

  it('rejects a user who is not a student with 400', () => {
    const result = validateEnrollment({
      student: { id: 'user-1', role: 'doctor' },
      section: { id: 'section-1', subject_id: 'subject-1' },
      subjectId: 'subject-1',
    });
    expect(result?.status).toBe(400);
  });

  it('rejects a section belonging to a different subject with 400', () => {
    const result = validateEnrollment({
      student: { id: 'student-1', role: 'student' },
      section: { id: 'section-1', subject_id: 'subject-2' },
      subjectId: 'subject-1',
    });
    expect(result?.status).toBe(400);
  });

  it('answers 404 for a missing student or a missing section', () => {
    expect(
      validateEnrollment({
        student: null,
        section: { id: 'section-1', subject_id: 'subject-1' },
        subjectId: 'subject-1',
      })?.status,
    ).toBe(404);
    expect(
      validateEnrollment({
        student: { id: 'student-1', role: 'student' },
        section: null,
        subjectId: 'subject-1',
      })?.status,
    ).toBe(404);
  });
});

describe('permission key validator', () => {
  it('accepts every real key from the shared vocabulary', () => {
    for (const key of PERMISSION_KEYS) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it('rejects a made-up dotted key and non-strings', () => {
    expect(isPermissionKey('users.manage_all')).toBe(false);
    expect(isPermissionKey('edit_users')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
    expect(isPermissionKey(undefined)).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });

  it('validates roles against the shared role vocabulary', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('dean')).toBe(false);
  });
});

describe('self-lockout rule', () => {
  const base = {
    actorId: 'admin-1',
    actorRole: 'admin' as const,
    actorRoleDefault: true,
    actorOverride: null as boolean | null,
    targetUserId: null as string | null,
    targetRole: 'admin' as const,
    permissionKey: 'permissions.manage',
    nextAllowed: false,
  };

  it('refuses a role-default change that would strip the caller', () => {
    expect(selfLockoutError(base)).toBe(SELF_LOCKOUT_ERROR);
  });

  it('allows revoking permissions.manage from another role', () => {
    expect(selfLockoutError({ ...base, targetRole: 'doctor' })).toBeNull();
  });

  it('allows revoking permissions.manage from another admin', () => {
    expect(selfLockoutError({ ...base, targetUserId: 'admin-2' })).toBeNull();
  });

  it('ignores changes to any other permission key', () => {
    expect(selfLockoutError({ ...base, permissionKey: 'users.manage' })).toBeNull();
    expect(selfLockoutError({ ...base, permissionKey: 'term.reset' })).toBeNull();
  });

  it('allows granting permissions back to the caller role', () => {
    expect(selfLockoutError({ ...base, nextAllowed: true })).toBeNull();
  });

  it('still blocks a role-default revoke when the caller holds no override', () => {
    expect(selfLockoutError({ ...base, actorOverride: null })).toBe(SELF_LOCKOUT_ERROR);
  });

  it('refuses clearing the caller override when the role default is already false', () => {
    expect(
      selfLockoutError({
        ...base,
        actorRoleDefault: false,
        actorOverride: true,
        targetUserId: 'admin-1',
        nextAllowed: null,
      }),
    ).toBe(SELF_LOCKOUT_ERROR);
  });

  it('allows clearing the caller override while the role default is still true', () => {
    expect(
      selfLockoutError({
        ...base,
        actorRoleDefault: true,
        actorOverride: true,
        targetUserId: 'admin-1',
        nextAllowed: null,
      }),
    ).toBeNull();
  });

  it('refuses an explicit false override on the caller while the role default is false', () => {
    expect(
      selfLockoutError({
        ...base,
        actorRoleDefault: false,
        targetUserId: 'admin-1',
        nextAllowed: false,
      }),
    ).toBe(SELF_LOCKOUT_ERROR);
  });

  it('ignores an explicit false on a key the caller does not need for the door', () => {
    expect(
      selfLockoutError({ ...base, targetUserId: 'admin-1', permissionKey: 'users.manage' }),
    ).toBeNull();
  });
});

describe('getRolePermissionMatrix', () => {
  it('reads a missing Permission row as false and covers the whole rectangle', async () => {
    prisma.permission.findMany.mockResolvedValueOnce([
      { role: 'admin', permission_key: 'users.manage', allowed: true },
    ]);

    const matrix = await getRolePermissionMatrix();

    expect(matrix.admin['users.manage']).toBe(true);
    expect(matrix.admin['term.reset']).toBe(false);
    expect(Object.keys(matrix)).toHaveLength(4);
    for (const role of ROLES) {
      expect(Object.keys(matrix[role])).toHaveLength(PERMISSION_KEYS.length);
    }
  });
});

describe('getUserPermissionRows', () => {
  it('reports default, override and effective value for every key', async () => {
    prisma.permission.findMany.mockResolvedValueOnce([
      { permission_key: 'permissions.manage', allowed: true },
    ]);
    prisma.userPermissionOverride.findMany.mockResolvedValueOnce([
      { permission_key: 'permissions.manage', allowed: false },
    ]);

    const rows = await getUserPermissionRows('admin-1', 'admin');

    expect(rows).toHaveLength(PERMISSION_KEYS.length);
    const own = rows.find((row) => row.permission_key === 'permissions.manage');
    expect(own).toEqual({
      permission_key: 'permissions.manage',
      role_default: true,
      override: false,
      effective: false,
    });
    const untouched = rows.find((row) => row.permission_key === 'users.manage');
    expect(untouched).toEqual({
      permission_key: 'users.manage',
      role_default: false,
      override: null,
      effective: false,
    });
  });
});

describe('validateDoctorAssignment', () => {
  const doctor = { id: 'doctor-1', role: 'doctor' as const };

  it('accepts a doctor with a set of existing subjects', () => {
    expect(
      validateDoctorAssignment({
        doctor,
        subjectIds: ['sub-1', 'sub-2'],
        existingSubjectIds: ['sub-1', 'sub-2'],
      }),
    ).toBeNull();
  });

  it('accepts an empty subject list, which is how a doctor is cleared of all subjects', () => {
    expect(validateDoctorAssignment({ doctor, subjectIds: [], existingSubjectIds: [] })).toBeNull();
  });

  it('404s when the doctor does not exist', () => {
    expect(
      validateDoctorAssignment({ doctor: null, subjectIds: ['sub-1'], existingSubjectIds: ['sub-1'] }),
    ).toEqual({ status: 404, error: 'Doctor not found' });
  });

  it('400s when the id belongs to a user who is not a doctor', () => {
    // The database does not enforce this, so the handler has to.
    for (const role of ['admin', 'ta', 'student'] as const) {
      expect(
        validateDoctorAssignment({
          doctor: { id: 'user-1', role },
          subjectIds: [],
          existingSubjectIds: [],
        }),
      ).toEqual({ status: 400, error: 'doctor_id must reference a user with the doctor role' });
    }
  });

  it('404s rather than silently dropping a subject that does not exist', () => {
    expect(
      validateDoctorAssignment({
        doctor,
        subjectIds: ['sub-1', 'ghost'],
        existingSubjectIds: ['sub-1'],
      }),
    ).toEqual({ status: 404, error: 'Subject not found' });
  });

  it('names the problem when several subjects are missing', () => {
    expect(
      validateDoctorAssignment({
        doctor,
        subjectIds: ['ghost-a', 'ghost-b'],
        existingSubjectIds: [],
      }),
    ).toEqual({ status: 404, error: 'Subjects not found' });
  });

  it('rejects the doctor before it looks at subjects, so a bad id never reads as a missing subject', () => {
    expect(
      validateDoctorAssignment({ doctor: { id: 'ta-1', role: 'ta' }, subjectIds: ['ghost'], existingSubjectIds: [] }),
    ).toEqual({ status: 400, error: 'doctor_id must reference a user with the doctor role' });
  });
});
