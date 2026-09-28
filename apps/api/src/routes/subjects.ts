import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { buildScopedSubjectWhere, buildScopedSectionWhere } from '../services/subject-access.js';

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
// ---------------------------------------------------------------------------

async function subjectExists(subjectId: string): Promise<boolean> {
  return (await prisma.subject.count({ where: { id: subjectId } })) > 0;
}

subjectsRouter.get('/:id/sections', async (req, res, next) => {
  try {
    const { userId, role } = req.auth!;
    const subjectId = req.params.id;
    if (!(await subjectExists(subjectId))) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const sections = await prisma.section.findMany({
      where: buildScopedSectionWhere(role, userId, subjectId),
      select: { id: true, subject_id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

subjectsRouter.get('/:id/students', async (req, res, next) => {
  try {
    const { userId, role } = req.auth!;
    const subjectId = req.params.id;
    if (!(await subjectExists(subjectId))) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Enrollment is the authority on "is this student in this subject". A TA is
    // narrowed to their own sections, because exams.ts rejects a TA quiz aimed at
    // anyone else -- offering the wider list would hand them a dead end.
    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        enrollments: { some: { subject_id: subjectId } },
        ...(role === 'ta'
          ? { section_memberships: { some: { section: { ta_id: userId, subject_id: subjectId } } } }
          : {}),
      },
      select: {
        id: true,
        full_name: true,
        student_code: true,
        section_memberships: {
          where: { section: { subject_id: subjectId } },
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
