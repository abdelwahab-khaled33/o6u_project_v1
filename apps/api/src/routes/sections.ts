import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { buildScopedSectionWhere } from '../services/subject-access.js';

export const sectionsRouter = Router();

sectionsRouter.use(requireAuth, requireRoles('admin', 'doctor', 'ta'));

const sectionListQuerySchema = z.object({ subject_id: z.string().min(1).optional() });

sectionsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = sectionListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid section filter' });
    }

    const sections = await prisma.section.findMany({
      where: buildScopedSectionWhere(req.auth!.role, req.auth!.userId, parsed.data.subject_id),
      select: {
        id: true,
        name: true,
        subject_id: true,
        ta_id: true,
        subject: { select: { id: true, code: true, name: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});
