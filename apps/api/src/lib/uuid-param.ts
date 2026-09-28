import type { RequestHandler } from 'express';

/**
 * The canonical hyphenated 8-4-4-4-12 hex form, deliberately not a v4 check:
 * Postgres casts any hex in that shape to `uuid`, so a stricter test here would
 * 404 a row that genuinely exists.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Rejects a malformed path id with the route's own not-found response instead of
 * letting it reach Prisma, which throws P2023 on a non-uuid and surfaces as a 500.
 *
 * A non-uuid is answered 404 rather than 400 so that a malformed id and a
 * well-formed id that matches no row are indistinguishable, and so the message
 * stays the one the route already uses. Place it after `requireRoles` /
 * `requirePermission`: an unauthorized caller must still get 403.
 */
export function requireUuidParam(param: string, message: string): RequestHandler {
  return (req, res, next) => {
    if (isUuid(req.params[param])) {
      next();
      return;
    }
    res.status(404).json({ error: message });
  };
}
