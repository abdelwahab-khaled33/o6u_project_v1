import type { Prisma } from '@prisma/client';
import type { PermissionKey, Role } from '@exam/shared';
import { DEFAULT_PERMISSIONS, PERMISSION_KEYS, ROLES } from '@exam/shared';
import { prisma } from '../lib/prisma.js';

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);
const ROLE_SET = new Set<string>(ROLES);

export const PERMISSIONS_MANAGE: PermissionKey = 'permissions.manage';

export const SELF_LOCKOUT_ERROR =
  'Refusing to remove your own permissions.manage access: the permission matrix would be unreachable for you';

export const userSelect = {
  id: true,
  username: true,
  full_name: true,
  role: true,
  student_code: true,
  is_active: true,
  can_change_password: true,
  created_at: true,
} as const satisfies Prisma.UserSelect;

export interface UserListFilters {
  role?: string;
  subject_id?: string;
  section_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export function buildUserWhere(filters: UserListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const and: Prisma.UserWhereInput[] = [];

  if (filters.role && ROLE_SET.has(filters.role)) {
    where.role = filters.role as Role;
  }

  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { full_name: { contains: search, mode: 'insensitive' } },
      { student_code: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (filters.subject_id) {
    and.push({
      OR: [
        { enrollments: { some: { subject_id: filters.subject_id } } },
        { section_memberships: { some: { section: { subject_id: filters.subject_id } } } },
      ],
    });
  }

  if (filters.section_id) {
    and.push({ section_memberships: { some: { section_id: filters.section_id } } });
  }

  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}

export interface Paging {
  page: number;
  page_size: number;
  skip: number;
  take: number;
}

function positiveInt(value: number): number {
  const truncated = Math.trunc(value);
  return Number.isFinite(truncated) && truncated > 0 ? truncated : 1;
}

export function resolvePaging(page?: number, page_size?: number): Paging | null {
  if (page === undefined || page_size === undefined) {
    return null;
  }
  const size = Math.min(200, positiveInt(page_size));
  const normalizedPage = positiveInt(page);
  return { page: normalizedPage, page_size: size, skip: (normalizedPage - 1) * size, take: size };
}

export function canChangePasswordForCreate(role: Role, requested?: boolean | null): boolean {
  return role === 'student' ? false : requested ?? true;
}

export function canChangePasswordForPatch(
  effectiveRole: Role,
  requested?: boolean | null,
): boolean | undefined {
  return effectiveRole === 'student' ? false : requested ?? undefined;
}

export interface EnrollmentValidationInput {
  student: { id: string; role: Role } | null;
  section: { id: string; subject_id: string } | null;
  subjectId: string;
}

export interface EnrollmentRejection {
  status: 404 | 400;
  error: string;
}

export interface ValidationRejection {
  status: 404 | 400;
  error: string;
}

export interface DoctorAssignmentValidationInput {
  doctor: { id: string; role: Role } | null;
  subjectIds: string[];
  existingSubjectIds: string[];
}

export function validateDoctorAssignment(
  input: DoctorAssignmentValidationInput,
): ValidationRejection | null {
  if (!input.doctor) {
    return { status: 404, error: 'Doctor not found' };
  }
  if (input.doctor.role !== 'doctor') {
    return { status: 400, error: 'doctor_id must reference a user with the doctor role' };
  }
  const known = new Set(input.existingSubjectIds);
  const missing = input.subjectIds.filter((id) => !known.has(id));
  if (missing.length === 1) {
    return { status: 404, error: 'Subject not found' };
  }
  if (missing.length > 1) {
    return { status: 404, error: 'Subjects not found' };
  }
  return null;
}

export function validateEnrollment(input: EnrollmentValidationInput): EnrollmentRejection | null {
  if (!input.student) {
    return { status: 404, error: 'Student not found' };
  }
  if (input.student.role !== 'student') {
    return { status: 400, error: 'Only users with the student role can be enrolled' };
  }
  if (!input.section) {
    return { status: 404, error: 'Section not found' };
  }
  if (input.section.subject_id !== input.subjectId) {
    return {
      status: 400,
      error: 'Section belongs to a different subject; pick a section of the requested subject',
    };
  }
  return null;
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLE_SET.has(value);
}

export interface SelfLockoutInput {
  actorId: string;
  actorRole: Role;
  actorRoleDefault: boolean;
  actorOverride: boolean | null;
  targetUserId: string | null;
  targetRole: Role;
  permissionKey: string;
  nextAllowed: boolean | null;
}

export function selfLockoutError(input: SelfLockoutInput): string | null {
  if (input.permissionKey !== PERMISSIONS_MANAGE) {
    return null;
  }

  const concernsActor =
    input.targetUserId === input.actorId ||
    (input.targetUserId === null && input.targetRole === input.actorRole);

  if (!concernsActor) {
    return null;
  }

  const nextDefault = input.nextAllowed ?? input.actorRoleDefault;
  const effectiveAfter =
    input.targetUserId === input.actorId ? nextDefault : input.actorOverride ?? nextDefault;

  return effectiveAfter ? null : SELF_LOCKOUT_ERROR;
}

export const LAST_ADMIN_ERROR =
  'This is the last active administrator. Promote or activate another admin before ' +
  'deactivating or changing the role of this one.';

export interface LastAdminInput {
  target: { id: string; role: Role; is_active: boolean };
  nextRole?: Role;
  nextIsActive?: boolean;
  activeAdminCount: number;
}

/**
 * The user-edit equivalent of selfLockoutError.
 *
 * `role` and `is_active` decide whether anyone can reach an admin route at all, so they
 * are the fields that can lock the platform out of its own recovery path. The permissions
 * screen is the way back from a lost permission; there is no screen that can re-grant
 * `admin`, because reaching one already requires being one.
 *
 * The guard is about the resulting state, not about who made the change: deactivating or
 * demoting the last active admin is refused whoever asks, including the actor themselves.
 */
export function lastActiveAdminError(input: LastAdminInput): string | null {
  const { target, activeAdminCount } = input;
  if (target.role !== 'admin') return null;
  if (activeAdminCount > 1) return null;

  const nextRole = input.nextRole ?? target.role;
  const nextIsActive = input.nextIsActive ?? target.is_active;

  const remainsAdmin = nextRole === 'admin' && nextIsActive;
  return remainsAdmin ? null : LAST_ADMIN_ERROR;
}

export async function getSectionDependents(sectionId: string) {
  const [memberships, exam_targets] = await Promise.all([
    prisma.sectionMembership.count({ where: { section_id: sectionId } }),
    prisma.examTargetSection.count({ where: { section_id: sectionId } }),
  ]);
  return { memberships, exam_targets };
}

export async function getSubjectDependents(subjectId: string) {
  const [sections, questions, exams, enrollments, doctor_assignments] = await Promise.all([
    prisma.section.count({ where: { subject_id: subjectId } }),
    prisma.question.count({ where: { subject_id: subjectId } }),
    prisma.exam.count({ where: { subject_id: subjectId } }),
    prisma.enrollment.count({ where: { subject_id: subjectId } }),
    prisma.doctorAssignment.count({ where: { subject_id: subjectId } }),
  ]);
  return { sections, questions, exams, enrollments, doctor_assignments };
}

export type RolePermissionMatrix = Record<Role, Record<PermissionKey, boolean>>;

export type DefaultPermissionRow = { role: Role; permission_key: PermissionKey; allowed: boolean };

/**
 * The 72-row seed rectangle (every role × every key), valued from
 * DEFAULT_PERMISSIONS — the same source the seed and the permission-matrix
 * migration read. Reset restores exactly this and nothing else: per-user
 * overrides are untouched, so a caller holding permissions.manage through an
 * override cannot lock themselves out by resetting the defaults.
 */
export function buildDefaultPermissionRows(): DefaultPermissionRow[] {
  const rows: DefaultPermissionRow[] = [];
  for (const role of ROLES) {
    for (const key of PERMISSION_KEYS) {
      rows.push({ role, permission_key: key, allowed: DEFAULT_PERMISSIONS[key].includes(role) });
    }
  }
  return rows;
}

export async function getRolePermissionMatrix(): Promise<RolePermissionMatrix> {
  const rows = await prisma.permission.findMany({ select: { role: true, permission_key: true, allowed: true } });
  const stored = new Map(rows.map((row) => [`${row.role}:${row.permission_key}`, row.allowed]));

  const matrix = {} as RolePermissionMatrix;
  for (const role of ROLES) {
    const perRole = {} as Record<PermissionKey, boolean>;
    for (const key of PERMISSION_KEYS) {
      perRole[key] = stored.get(`${role}:${key}`) ?? false;
    }
    matrix[role] = perRole;
  }
  return matrix;
}

export async function getUserPermissionRows(userId: string, role: Role) {
  const [defaults, overrides] = await Promise.all([
    prisma.permission.findMany({ where: { role }, select: { permission_key: true, allowed: true } }),
    prisma.userPermissionOverride.findMany({
      where: { user_id: userId },
      select: { permission_key: true, allowed: true },
    }),
  ]);

  const defaultByKey = new Map(defaults.map((row) => [row.permission_key, row.allowed]));
  const overrideByKey = new Map(overrides.map((row) => [row.permission_key, row.allowed]));

  return PERMISSION_KEYS.map((key) => {
    const role_default = defaultByKey.get(key) ?? false;
    const override = overrideByKey.get(key) ?? null;
    return {
      permission_key: key,
      role_default,
      override,
      effective: override ?? role_default,
    };
  });
}
