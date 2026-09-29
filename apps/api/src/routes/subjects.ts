import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import {
  buildScopedSubjectWhere,
  buildScopedSectionWhere,
  visibleRosterSubjectId,
} from '../services/subject-access.js';

export const subjectsRouter = Router();

subjectsRouter.use(requireAuth, requireRoles('admin', 'doctor', 'ta'));

subjectsRouter.get('/', async (req, res, next) => {
  try {
    const { userId, role } = req.auth!;
    const subjects = await prisma.subject.findMany({
      where: buildScopedSubjectWhere(role, userId),
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    res.json({ subjects });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Roster reads
//
// These exist because a TA cannot target a whole subject (exams.ts refuses
// target_scope 'subject' for a TA), so a quiz has to be aimed at sections or at
// named students -- and until now there was no endpoint a TA could call to see
// either. They deliberately carry no permission key, for the same reason GET /subjects
// does: section 9 governs management actions and has no read-only roster key, so the
// scope itself is the authorization.
//
// Both routes resolve the requested subject through visibleRosterSubjectId first. That
// is not defensive duplication: /sections already scoped a doctor to their assigned
// subjects while /students scoped only a TA, so a doctor with no doctor_assignments was
// refused the section list and handed the full name, student code and section of every
// enrolled student. One gate, two routes, so they cannot drift apart again.
// ---------------------------------------------------------------------------

async function subjectExists(subjectId: string): Promise<boolean> {
  return (await prisma.subject.count({ where: { id: subjectId } })) > 0;
}

subjectsRouter.get('/:id/sections', requireUuidParam('id', 'Subject not found'), async (req, res, next) => {
  try {
    const { userId, role } = req.auth!;
    // `as string` because Express only infers a path param from the route literal when
    // the handler is the second argument; the uuid guard makes it the third. The guard has
    // already rejected anything that is not a well-formed id, so this is not a cast that
    // hides a missing value.
    const subjectId = req.params.id as string;
    if (!(await subjectExists(subjectId))) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    const visibleSubjectId = await visibleRosterSubjectId(role, userId, subjectId);

    const sections = await prisma.section.findMany({
      where: buildScopedSectionWhere(role, userId, visibleSubjectId),
      select: { id: true, subject_id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

subjectsRouter.get('/:id/students', requireUuidParam('id', 'Subject not found'), async (req, res, next) => {
  try {
    const { userId, role } = req.auth!;
    const subjectId = req.params.id as string;
    if (!(await subjectExists(subjectId))) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    const visibleSubjectId = await visibleRosterSubjectId(role, userId, subjectId);

    // Enrollment is the authority on "is this student in this subject". The TA's own
    // section filter is kept on top of the gate, matching the create-exam check that
    // rejects a TA quiz aimed at anyone else.
    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        enrollments: { some: { subject_id: visibleSubjectId } },
        ...(role === 'ta'
          ? { section_memberships: { some: { section: { ta_id: userId, subject_id: visibleSubjectId } } } }
          : {}),
      },
      select: {
        id: true,
        full_name: true,
        student_code: true,
        section_memberships: {
          where: { section: { subject_id: visibleSubjectId } },
          select: { section: { select: { id: true, name: true } } },
        },
      },
      orderBy: { full_name: 'asc' },
    });

    res.json({
      students: students.map((student) => {
        const membership = student.section_memberships[0];
        return {
          id: student.id,
          full_name: student.full_name,
          student_code: student.student_code,
          section_id: membership?.section.id ?? null,
          section_name: membership?.section.name ?? null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});
