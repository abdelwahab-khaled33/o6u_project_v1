import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { buildScopedSubjectWhere } from '../services/subject-access.js';

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
