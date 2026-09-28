import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type AuthPayload } from '../lib/jwt.js';
import type { PermissionKey, Role } from '@exam/shared';
import { PERMISSION_KEYS } from '@exam/shared';
import { resolvePermissionAccess } from '../services/permissions.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyToken(token);
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
