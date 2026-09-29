import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type AuthPayload } from '../lib/jwt.js';
import type { PermissionKey, Role } from '@exam/shared';
import { PERMISSION_KEYS } from '@exam/shared';
import { resolvePermissionAccess } from '../services/permissions.js';
import { prisma } from '../lib/prisma.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

/**
 * A JWT says who signed in. It does not say what that person may still do, and the
 * signature cannot express "this account was deactivated ten minutes ago": the token is
 * good for 8 hours regardless. So the role and the active flag are re-read on every
 * request and the row wins over the claim.
 *
 * Without this, deactivating a TA or demoting an admin took effect only at token expiry.
 * It looked like it had partly worked, because requirePermission re-reads the account
 * too, so a deactivated TA was refused on /question-bank and allowed on /subjects,
 * /exams and /auth/me for the rest of the window.
 *
 * The cost is one primary-key lookup per request. That is the right trade for an exam
 * platform: a revoked account must stop working now, not in up to eight hours.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice('Bearer '.length);

  let payload: AuthPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Async from here on, so the rejection has to be caught here. Express 4 does not
  // catch a rejected promise from a middleware, and an unhandled one would hang the
  // request instead of answering it.
  void (async () => {
    try {
      const account = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, is_active: true },
      });

      if (!account) {
        // A well-formed token for an account that no longer exists. 401, not 403: the
        // session itself is not valid, so the client should clear it.
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      if (!account.is_active) {
        // 403, never 401. The client treats 401 as "session expired" and logs the user
        // out, which would make a deactivation indistinguishable from an expiry.
        res.status(403).json({ error: 'Account is inactive' });
        return;
      }

      req.auth = { userId: account.id, role: account.role };
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

const VALID_KEYS = new Set<string>(PERMISSION_KEYS);

export function requirePermission(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!VALID_KEYS.has(key)) {
      return res.status(500).json({ error: `Unknown permission key: ${key}` });
    }

    try {
      const access = await resolvePermissionAccess(req.auth.userId, req.auth.role, key);

      if (!access.active) {
        return res.status(403).json({ error: 'Account is inactive' });
      }

      if (!access.permission.allowed) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
