import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function toPublicUser(u: {
  id: string;
  username: string;
  full_name: string;
  role: string;
  can_change_password: boolean;
}) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role,
    canChangePassword: u.can_change_password,
  };
}

/**
 * A valid bcrypt hash to compare against when no account matched.
 *
 * bcrypt.compare is by far the most expensive thing this handler does. Returning before
 * it for an unknown username answers in ~3ms instead of ~100ms, which turns the login
 * endpoint into a free username oracle: enumerate the student roll, then spend the
 * cracking effort only on the accounts that exist. Comparing against this decoy makes the
 * unknown-username path cost the same as a real one. The hash is of a value nobody knows,
 * and its result is discarded.
 */
const DECOY_PASSWORD_HASH = bcrypt.hashSync('no-such-account-decoy', 10);

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username },
    });

    const ok = await bcrypt.compare(
      parsed.data.password,
      user?.password_hash ?? DECOY_PASSWORD_HASH,
    );

    if (!user || !user.is_active || !ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user.id, user.role);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(72),
});

authRouter.post('/change-password', requireAuth, requirePermission('password.change_own'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.can_change_password) {
      return res.status(403).json({
        error: 'Password is fixed by the platform and cannot be changed',
      });
    }

    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid current and new passwords are required (new: 8-72 chars)' });
    }

    const ok = await bcrypt.compare(parsed.data.current_password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(parsed.data.new_password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password_hash: hash },
    });

    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});
