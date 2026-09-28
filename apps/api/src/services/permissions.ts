import type { PermissionKey, Role } from '@exam/shared';
import { prisma } from '../lib/prisma.js';

export async function resolvePermission(userId: string, role: Role, key: PermissionKey) {
  const [permission, override] = await Promise.all([
    prisma.permission.findUnique({
      where: { role_permission_key: { role, permission_key: key } },
    }),
    prisma.userPermissionOverride.findUnique({
      where: { user_id_permission_key: { user_id: userId, permission_key: key } },
    }),
  ]);

  const default_allowed = permission?.allowed ?? false;
  const override_allowed = override?.allowed ?? null;

  return {
    allowed: override_allowed ?? default_allowed,
    default_allowed,
    override: override_allowed,
  };
}

export async function resolvePermissionAccess(userId: string, role: Role, key: PermissionKey) {
  const [user, permission] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { is_active: true } }),
    resolvePermission(userId, role, key),
  ]);

  return { active: user?.is_active ?? false, permission };
}
