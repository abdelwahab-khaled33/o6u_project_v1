import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_APPLICABLE_PERMISSIONS,
} from '@exam/shared';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

import { resolvePermission, resolvePermissionAccess } from './permissions.js';

describe('permission vocabulary', () => {
  it('covers every one of the 18 applicable permission keys', () => {
    expect(new Set(PERMISSION_KEYS)).toHaveLength(18);
    for (const key of PERMISSION_KEYS) {
      expect(Object.values(ROLE_APPLICABLE_PERMISSIONS).flat()).toContain(key);
    }
  });

  it('denies TA grade adjustment and non-students exam taking by default', () => {
    expect(DEFAULT_PERMISSIONS['grades.adjust']).not.toContain('ta');
    expect(DEFAULT_PERMISSIONS['exam.take']).toEqual(['student']);
  });
});

describe('resolvePermission', () => {
  it('uses a true override over a false role default', async () => {
    prisma.permission.findUnique.mockResolvedValueOnce({ allowed: false });
    prisma.userPermissionOverride.findUnique.mockResolvedValueOnce({ allowed: true });

    await expect(resolvePermission('user-1', 'doctor', 'exam.create')).resolves.toEqual({
      allowed: true,
      default_allowed: false,
      override: true,
    });
  });

  it('uses a false override over a true role default', async () => {
    prisma.permission.findUnique.mockResolvedValueOnce({ allowed: true });
    prisma.userPermissionOverride.findUnique.mockResolvedValueOnce({ allowed: false });

    await expect(resolvePermission('user-1', 'doctor', 'exam.create')).resolves.toEqual({
      allowed: false,
      default_allowed: true,
      override: false,
    });
  });

  it('uses the role row when no override exists and denies a missing row', async () => {
    prisma.permission.findUnique.mockResolvedValueOnce({ allowed: true });
    prisma.userPermissionOverride.findUnique.mockResolvedValueOnce(null);
    prisma.permission.findUnique.mockResolvedValueOnce(null);
    prisma.userPermissionOverride.findUnique.mockResolvedValueOnce(null);

    await expect(resolvePermission('doctor-1', 'doctor', 'exam.create')).resolves.toEqual({
      allowed: true,
      default_allowed: true,
      override: null,
    });
    await expect(resolvePermission('ta-1', 'ta', 'quiz.create')).resolves.toEqual({
      allowed: false,
      default_allowed: false,
      override: null,
    });
  });
});

describe('resolvePermissionAccess', () => {
  it('denies an inactive account even when its permission row allows the action', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ is_active: false });
    prisma.permission.findUnique.mockResolvedValueOnce({ allowed: true });
    prisma.userPermissionOverride.findUnique.mockResolvedValueOnce(null);

    await expect(resolvePermissionAccess('doctor-1', 'doctor', 'exam.create')).resolves.toEqual({
      active: false,
      permission: {
        allowed: true,
        default_allowed: true,
        override: null,
      },
    });
  });
});
