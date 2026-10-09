import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import {
  PERMISSION_KEYS,
  ROLE_APPLICABLE_PERMISSIONS,
  ROLES,
} from '@exam/shared';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission, requireRoles } from '../middleware/auth.js';
import { resolvePermission } from '../services/permissions.js';
import {
  RESET_CONFIRMATION_PHRASE,
  getTermResetCounts,
  isValidResetConfirmation,
  runTermReset,
} from '../services/term-reset.js';
import {
  PASSWORD_RESET_THROTTLE,
  checkSingleThrottle,
  passwordResetKey,
  recordSingleThrottle,
} from '../services/login-throttle.js';
import { dryRunUserImport, commitUserImport } from '../services/users-import.js';
import {
  PERMISSIONS_MANAGE,
  buildDefaultPermissionRows,
  buildUserWhere,
  canChangePasswordForCreate,
  canChangePasswordForPatch,
  getRolePermissionMatrix,
  getSectionDependents,
  getSubjectDependents,
  getUserPermissionRows,
  isPermissionKey,
  isRole,
  lastActiveAdminError,
  resolvePaging,
  selfLockoutError,
  userSelect,
  validateDoctorAssignment,
  validateEnrollment,
} from '../services/admin-management.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRoles('admin'));

const termResetSchema = z.object({
  confirmation: z.string().min(1),
});

adminRouter.get('/term/reset', requireRoles('admin'), requirePermission('term.reset'), async (_req, res, next) => {
  try {
    const counts = await getTermResetCounts();
    res.json({ confirmation_phrase: RESET_CONFIRMATION_PHRASE, counts });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/term/reset', requireRoles('admin'), requirePermission('term.reset'), async (req, res, next) => {
  try {
    const parsed = termResetSchema.safeParse(req.body);
    if (!parsed.success || !isValidResetConfirmation(parsed.data.confirmation)) {
      return res.status(400).json({ error: 'Confirmation must match the required term reset phrase' });
    }

    const counts = await runTermReset();
    const warnings: string[] = [];

    try {
      const uploadsDir = path.resolve(process.cwd(), 'uploads');
      await fs.rm(uploadsDir, { recursive: true, force: true });
      await fs.mkdir(path.join(uploadsDir, 'images'), { recursive: true });
    } catch (err) {
      warnings.push(`Question image cleanup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }

    res.json({ counts, warnings });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

adminRouter.get('/users', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const query = req.query;
    const paging = resolvePaging(
      query.page === undefined ? undefined : Number(query.page),
      query.page_size === undefined ? undefined : Number(query.page_size),
    );

    const where = buildUserWhere({
      role: typeof query.role === 'string' ? query.role : undefined,
      subject_id: typeof query.subject_id === 'string' ? query.subject_id : undefined,
      section_id: typeof query.section_id === 'string' ? query.section_id : undefined,
      search: typeof query.search === 'string' ? query.search : undefined,
    });

    if (!paging) {
      const users = await prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { full_name: 'asc' },
      });
      return res.json({ users });
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { full_name: 'asc' },
        skip: paging.skip,
        take: paging.take,
      }),
      prisma.user.count({ where }),
    ]);
    return res.json({ users, total, page: paging.page, page_size: paging.page_size });
  } catch (err) {
    next(err);
  }
});

const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'doctor', 'ta', 'student']),
  password: z.string().min(8).max(72),
  student_code: z.string().min(1).max(50).optional(),
  can_change_password: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

adminRouter.post('/users', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'username, full_name, role and an 8-72 character password are required' });
    }

    const usernameTaken = await prisma.user.findUnique({
      where: { username: parsed.data.username },
      select: { id: true },
    });
    if (usernameTaken) {
      return res.status(409).json({ error: 'A user with this username already exists' });
    }

    const studentCode = parsed.data.role === 'student' ? parsed.data.student_code : undefined;
    if (studentCode) {
      const codeTaken = await prisma.user.findUnique({
        where: { student_code: studentCode },
        select: { id: true },
      });
      if (codeTaken) {
        return res.status(409).json({ error: 'A user with this student code already exists' });
      }
    }

    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        full_name: parsed.data.full_name,
        role: parsed.data.role,
        password_hash: await bcrypt.hash(parsed.data.password, 10),
        student_code: studentCode ?? null,
        can_change_password: canChangePasswordForCreate(parsed.data.role, parsed.data.can_change_password),
        ...(parsed.data.is_active === undefined ? {} : { is_active: parsed.data.is_active }),
      },
      select: userSelect,
    });
    return res.status(201).json({ user });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A user with this username or student code already exists' });
    }
    next(err);
  }
});

const resetPasswordSchema = z.object({
  new_password: z.string().min(8).max(72),
});

adminRouter.post(
  '/users/:id/reset-password',
  requirePermission('users.manage'),
  requireUuidParam('id', 'User not found'),
  async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'new_password must be 8-72 characters' });
    }

    // Keyed from the token admin id, so one admin's bulk work never throttles
    // another's. Every attempt counts and a success does not clear it: the
    // route has no credential check of its own to fail on, so counting only
    // failures would let a script reset without bound. Ten an hour allows
    // manual admin work; bulk provisioning belongs in the Excel import.
    const resetKey = passwordResetKey(req.auth!.userId);
    const resetThrottle = await checkSingleThrottle(resetKey, PASSWORD_RESET_THROTTLE);
    if (resetThrottle.throttled) {
      res.setHeader('Retry-After', String(resetThrottle.retryAfterSec));
      return res.status(429).json({ error: 'Too many password resets. Try again later.' });
    }
    await recordSingleThrottle(resetKey, PASSWORD_RESET_THROTTLE);

    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // One transaction, because two independent awaits leave the worst state
    // reachable: the password is changed but the audit row is not, so a reset
    // that broke someone's access cannot be traced. The hash is computed before
    // the transaction opens so bcrypt does not hold a connection while it runs.
    const passwordHash = await bcrypt.hash(parsed.data.new_password, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password_hash: passwordHash },
      }),
      prisma.passwordResetAudit.create({
        data: { admin_id: req.auth!.userId, target_user_id: user.id },
      }),
    ]);
    return res.json({ reset: true });
  } catch (err) {
    next(err);
  }
});

const patchUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  role: z.enum(['admin', 'doctor', 'ta', 'student']).optional(),
  student_code: z.string().nullable().optional(),
  can_change_password: z.boolean().optional(),
});

adminRouter.patch(
  '/users/:id',
  requirePermission('users.manage'),
  requireUuidParam('id', 'User not found'),
  async (req, res, next) => {
  try {
    const parsed = patchUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user payload' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, is_active: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // `role` and `is_active` are the two fields that decide whether anyone can still reach
    // an admin route. Removing the last active admin is refused whatever else the request
    // carries, because unlike a lost permission there is no screen that can re-grant it.
    // Short-circuited on a non-admin target so the extra count never runs for one.
    if (
      existing.role === 'admin' &&
      (parsed.data.role != null || parsed.data.is_active != null)
    ) {
      const activeAdminCount = await prisma.user.count({
        where: { role: 'admin', is_active: true },
      });
      const lockout = lastActiveAdminError({
        target: existing,
        nextRole: parsed.data.role,
        nextIsActive: parsed.data.is_active,
        activeAdminCount,
      });
      if (lockout) {
        return res.status(400).json({ error: lockout });
      }
    }

    const effectiveRole = parsed.data.role ?? existing.role;
    const canChangePassword = canChangePasswordForPatch(effectiveRole, parsed.data.can_change_password);

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        ...(canChangePassword === undefined ? {} : { can_change_password: canChangePassword }),
      },
      select: userSelect,
    });
    return res.json({ user });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

const subjectSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1),
});

adminRouter.get('/subjects', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const subjects = await prisma.subject.findMany({
      orderBy: { code: 'asc' },
    });
    res.json({ subjects });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/subjects', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const parsed = subjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'code and name are required' });
    }
    const subject = await prisma.subject.create({ data: parsed.data });
    res.status(201).json({ subject });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch(
  '/subjects/:id',
  requirePermission('subjects.manage'),
  requireUuidParam('id', 'Subject not found'),
  async (req, res, next) => {
  try {
    const parsed = subjectSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid subject payload' });
    }
    const subject = await prisma.subject.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ subject });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete(
  '/subjects/:id',
  requirePermission('subjects.manage'),
  requireUuidParam('id', 'Subject not found'),
  async (req, res, next) => {
  try {
    const subject = await prisma.subject.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const dependents = await getSubjectDependents(subject.id);
    const total = Object.values(dependents).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      return res.status(409).json({
        error: 'Subject still has dependent records; remove them first (nothing was deleted)',
        dependents,
      });
    }

    await prisma.subject.delete({ where: { id: subject.id } });
    return res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionSchema = z.object({
  subject_id: z.string().min(1),
  ta_id: z.string().min(1),
  name: z.string().min(1),
});

adminRouter.get('/sections', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const sections = await prisma.section.findMany({
      include: {
        subject: { select: { code: true, name: true } },
        ta: { select: { id: true, full_name: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

const patchSectionSchema = z.object({
  name: z.string().min(1).optional(),
  ta_id: z.string().min(1).optional(),
});

async function findTa(taId: string) {
  return prisma.user.findUnique({ where: { id: taId }, select: { id: true, role: true } });
}

adminRouter.post('/sections', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const parsed = sectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'subject_id, ta_id and name are required' });
    }
    const ta = await findTa(parsed.data.ta_id);
    if (!ta) {
      return res.status(400).json({ error: 'ta_id does not reference an existing user' });
    }
    if (ta.role !== 'ta') {
      return res.status(400).json({ error: 'ta_id must reference a user with the ta role' });
    }
    const section = await prisma.section.create({ data: parsed.data });
    res.status(201).json({ section });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A section with this subject, TA and name already exists' });
    }
    next(err);
  }
});

adminRouter.patch(
  '/sections/:id',
  requirePermission('subjects.manage'),
  requireUuidParam('id', 'Section not found'),
  async (req, res, next) => {
  try {
    const parsed = patchSectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'name or ta_id is required' });
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'subject_id')) {
      return res.status(400).json({ error: 'subject_id cannot be changed; create a new section instead' });
    }

    const existing = await prisma.section.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (parsed.data.ta_id) {
      const ta = await findTa(parsed.data.ta_id);
      if (!ta) {
        return res.status(400).json({ error: 'ta_id does not reference an existing user' });
      }
      if (ta.role !== 'ta') {
        return res.status(400).json({ error: 'ta_id must reference a user with the ta role' });
      }
    }

    const section = await prisma.section.update({ where: { id: existing.id }, data: parsed.data });
    return res.json({ section });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A section with this subject, TA and name already exists' });
    }
    if ((err as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Section not found' });
    }
    next(err);
  }
});

adminRouter.delete(
  '/sections/:id',
  requirePermission('subjects.manage'),
  requireUuidParam('id', 'Section not found'),
  async (req, res, next) => {
  try {
    const section = await prisma.section.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const dependents = await getSectionDependents(section.id);
    const total = Object.values(dependents).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      return res.status(409).json({
        error: 'Section still has dependent records; remove them first (nothing was deleted)',
        dependents,
      });
    }

    await prisma.section.delete({ where: { id: section.id } });
    return res.json({ deleted: true });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Section not found' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

// .uuid(), not .min(1): these three go straight into a where clause inside the
// transaction, and Prisma throws P2023 on a non-uuid, which the error handler turns into
// a 500. A body field of the wrong shape is a bad request, so 400 is the right answer.
const enrollmentSchema = z.object({
  student_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  section_id: z.string().uuid(),
});

adminRouter.put('/enrollments', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const parsed = enrollmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'student_id, subject_id and section_id are required' });
    }
    const { student_id, subject_id, section_id } = parsed.data;

    const outcome = await prisma.$transaction(async (tx) => {
      const [student, section] = await Promise.all([
        tx.user.findUnique({ where: { id: student_id }, select: { id: true, role: true } }),
        tx.section.findUnique({ where: { id: section_id }, select: { id: true, subject_id: true } }),
      ]);

      const rejection = validateEnrollment({ student, section, subjectId: subject_id });
      if (rejection) {
        return rejection;
      }

      const enrollment = await tx.enrollment.upsert({
        where: { student_id_subject_id: { student_id, subject_id } },
        create: { student_id, subject_id },
        update: {},
      });

      const membership = await tx.sectionMembership.upsert({
        where: { student_id_section_id: { student_id, section_id } },
        create: { student_id, section_id },
        update: {},
      });

      const removed = await tx.sectionMembership.deleteMany({
        where: {
          student_id,
          section_id: { not: section_id },
          section: { subject_id },
        },
      });

      return { enrollment, membership, removed_memberships: removed.count };
    });

    if ('status' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    return res.json(outcome);
  } catch (err) {
    next(err);
  }
});

// Read-only view of one student's enrollments for the Users detail panel. The section is
// nullable by construction: the join is done in code over two independent reads, so an
// enrollment with no membership renders as "no section" rather than vanishing.
adminRouter.get(
  '/enrollments/:studentId',
  requirePermission('subjects.manage'),
  requireUuidParam('studentId', 'Student not found'),
  async (req, res, next) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, role: true },
    });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    if (student.role !== 'student') {
      return res.status(400).json({ error: 'Only students have enrollments' });
    }

    const [enrollments, memberships] = await Promise.all([
      prisma.enrollment.findMany({
        where: { student_id: student.id },
        include: { subject: { select: { id: true, code: true, name: true } } },
        orderBy: { subject: { code: 'asc' } },
      }),
      prisma.sectionMembership.findMany({
        where: { student_id: student.id },
        include: { section: { select: { id: true, name: true, subject_id: true } } },
      }),
    ]);

    const sectionBySubject = new Map(
      memberships.map((membership) => [
        membership.section.subject_id,
        { id: membership.section.id, name: membership.section.name },
      ]),
    );
    return res.json({
      student_id: student.id,
      enrollments: enrollments.map((enrollment) => ({
        subject: enrollment.subject,
        section: sectionBySubject.get(enrollment.subject.id) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Doctor assignments
// ---------------------------------------------------------------------------

const doctorAssignmentSchema = z.object({
  // .uuid() for the same reason as enrollmentSchema above: a non-uuid here reaches a
  // where clause inside the transaction and becomes a 500.
  doctor_id: z.string().uuid(),
  // Required, not optional: omitting it must be a 400 rather than "leave unchanged",
  // and an explicit empty array is how a doctor is cleared of every subject.
  subject_ids: z.array(z.string().uuid()),
});

adminRouter.get(
  '/doctor-assignments/:doctorId',
  requirePermission('subjects.manage'),
  requireUuidParam('doctorId', 'Doctor not found'),
  async (req, res, next) => {
  try {
    const doctor = await prisma.user.findUnique({
      where: { id: req.params.doctorId },
      select: { id: true, role: true },
    });

    // Reuses the write path's rejection so a non-doctor or unknown id reads the
    // same way here as it does on write, instead of answering an empty list.
    const rejection = validateDoctorAssignment({
      doctor,
      subjectIds: [],
      existingSubjectIds: [],
    });
    if (rejection) {
      return res.status(rejection.status).json({ error: rejection.error });
    }

    const rows = await prisma.doctorAssignment.findMany({
      where: { doctor_id: req.params.doctorId },
      select: { subject_id: true },
      orderBy: { subject_id: 'asc' },
    });

    return res.json({ doctor_id: req.params.doctorId, subject_ids: rows.map((r) => r.subject_id) });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/doctor-assignments', requirePermission('subjects.manage'), async (req, res, next) => {
  try {
    const parsed = doctorAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'doctor_id and subject_ids are required' });
    }

    const { doctor_id } = parsed.data;
    const subjectIds = [...new Set(parsed.data.subject_ids)];

    const outcome = await prisma.$transaction(async (tx) => {
      const doctor = await tx.user.findUnique({
        where: { id: doctor_id },
        select: { id: true, role: true },
      });
      const subjects = subjectIds.length
        ? await tx.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true } })
        : [];

      const rejection = validateDoctorAssignment({
        doctor,
        subjectIds,
        existingSubjectIds: subjects.map((s) => s.id),
      });
      if (rejection) {
        return rejection;
      }

      for (const subjectId of subjectIds) {
        await tx.doctorAssignment.upsert({
          where: { doctor_id_subject_id: { doctor_id, subject_id: subjectId } },
          create: { doctor_id, subject_id: subjectId },
          update: {},
        });
      }

      const removed = await tx.doctorAssignment.deleteMany({
        where: { doctor_id, subject_id: { notIn: subjectIds } },
      });

      return { doctor_id, subject_ids: subjectIds, removed_assignments: removed.count };
    });

    if ('status' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    return res.json(outcome);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

adminRouter.get('/permissions/defaults', requirePermission('permissions.manage'), async (_req, res, next) => {
  try {
    const matrix = await getRolePermissionMatrix();
    res.json({
      roles: ROLES,
      keys: PERMISSION_KEYS,
      applicable: ROLE_APPLICABLE_PERMISSIONS,
      matrix,
    });
  } catch (err) {
    next(err);
  }
});

const patchDefaultSchema = z.object({
  role: z.string().min(1),
  permission_key: z.string().min(1),
  allowed: z.boolean(),
});

adminRouter.patch('/permissions/defaults', requirePermission('permissions.manage'), async (req, res, next) => {
  try {
    const parsed = patchDefaultSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'role, permission_key and allowed are required' });
    }
    if (!isRole(parsed.data.role)) {
      return res.status(400).json({ error: `Unknown role: ${parsed.data.role}` });
    }
    if (!isPermissionKey(parsed.data.permission_key)) {
      return res.status(400).json({ error: `Unknown permission key: ${parsed.data.permission_key}` });
    }

    const { role, permission_key } = parsed.data;

    if (parsed.data.allowed === false) {
      const actor = req.auth!;
      const actorPermission = await resolvePermission(actor.userId, actor.role, PERMISSIONS_MANAGE);
      const lockout = selfLockoutError({
        actorId: actor.userId,
        actorRole: actor.role,
        actorRoleDefault: actorPermission.default_allowed,
        actorOverride: actorPermission.override,
        targetUserId: null,
        targetRole: role,
        permissionKey: permission_key,
        nextAllowed: parsed.data.allowed,
      });
      if (lockout) {
        return res.status(400).json({ error: lockout });
      }
    }

    const permission = await prisma.permission.upsert({
      where: { role_permission_key: { role, permission_key } },
      create: { role, permission_key, allowed: parsed.data.allowed },
      update: { allowed: parsed.data.allowed },
      select: { role: true, permission_key: true, allowed: true },
    });
    return res.json({ permission });
  } catch (err) {
    next(err);
  }
});

const resetDefaultsSchema = z.object({}).strict();

adminRouter.post('/permissions/defaults/reset', requirePermission('permissions.manage'), async (req, res, next) => {
  try {
    const parsed = resetDefaultsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Reset takes no request body' });
    }
    // One transaction: the table holds the full rectangle or the call fails.
    // Per-user overrides are untouched, so resetting cannot lock the caller out.
    const rows = buildDefaultPermissionRows();
    await prisma.$transaction([
      prisma.permission.deleteMany({}),
      prisma.permission.createMany({ data: rows }),
    ]);
    return res.json({ reset: true, defaults_restored: rows.length });
  } catch (err) {
    next(err);
  }
});

adminRouter.get(
  '/permissions/users/:id',
  requirePermission('permissions.manage'),
  requireUuidParam('id', 'User not found'),
  async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true, full_name: true, role: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const permissions = await getUserPermissionRows(user.id, user.role);
    return res.json({ user, applicable: ROLE_APPLICABLE_PERMISSIONS, permissions });
  } catch (err) {
    next(err);
  }
});

const patchUserPermissionSchema = z.object({
  permission_key: z.string().min(1),
  allowed: z.boolean().nullable(),
});

adminRouter.patch(
  '/permissions/users/:id',
  requirePermission('permissions.manage'),
  requireUuidParam('id', 'User not found'),
  async (req, res, next) => {
  try {
    const parsed = patchUserPermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'permission_key and allowed (boolean or null to clear) are required' });
    }
    if (!isPermissionKey(parsed.data.permission_key)) {
      return res.status(400).json({ error: `Unknown permission key: ${parsed.data.permission_key}` });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { permission_key } = parsed.data;
    const nextAllowed = parsed.data.allowed;

    if (nextAllowed !== true) {
      const actor = req.auth!;
      const actorPermission = await resolvePermission(actor.userId, actor.role, PERMISSIONS_MANAGE);
      const lockout = selfLockoutError({
        actorId: actor.userId,
        actorRole: actor.role,
        actorRoleDefault: actorPermission.default_allowed,
        actorOverride: actorPermission.override,
        targetUserId: user.id,
        targetRole: user.role,
        permissionKey: permission_key,
        nextAllowed,
      });
      if (lockout) {
        return res.status(400).json({ error: lockout });
      }
    }

    if (nextAllowed === null) {
      await prisma.userPermissionOverride.deleteMany({
        where: { user_id: user.id, permission_key },
      });
    } else {
      await prisma.userPermissionOverride.upsert({
        where: { user_id_permission_key: { user_id: user.id, permission_key } },
        create: { user_id: user.id, permission_key, allowed: nextAllowed },
        update: { allowed: nextAllowed },
      });
    }

    const permissions = await getUserPermissionRows(user.id, user.role);
    return res.json({ user_id: user.id, permission_key, permissions });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Excel import (users)
// ---------------------------------------------------------------------------

adminRouter.post('/users/import/dry-run', requirePermission('users.manage'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Excel file is required' });
    }
    const report = await dryRunUserImport(req.file.buffer);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/users/import/commit', requirePermission('users.manage'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Excel file is required' });
    }
    const report = await commitUserImport(
      req.file.buffer,
      req.auth!.userId,
      req.file.originalname,
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
});
