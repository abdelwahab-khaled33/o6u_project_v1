import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('./exam-eligibility.js', () => ({ getEligibleStudentIds: vi.fn() }));

import { checkPoolSufficiency } from './exam-sampling.js';

describe('checkPoolSufficiency', () => {
  it('accepts a pool that exactly satisfies the mix', () => {
    const pool = [
      { difficulty: 'easy' as const },
      { difficulty: 'easy' as const },
      { difficulty: 'medium' as const },
      { difficulty: 'hard' as const },
    ];
    expect(checkPoolSufficiency(pool, { easy: 2, medium: 1, hard: 1 })).toEqual({ ok: true });
  });

  it('rejects when a tier is short and names the shortfall', () => {
    const pool = [{ difficulty: 'easy' as const }];
    const result = checkPoolSufficiency(pool, { easy: 2, medium: 1, hard: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('1 easy');
    expect(result.error).toContain('2 are required');
  });

  it('ignores surplus questions in other tiers', () => {
    const pool = [
      { difficulty: 'easy' as const },
      { difficulty: 'easy' as const },
      { difficulty: 'medium' as const },
      { difficulty: 'medium' as const },
      { difficulty: 'medium' as const },
      { difficulty: 'hard' as const },
    ];
    expect(checkPoolSufficiency(pool, { easy: 1, medium: 1, hard: 1 })).toEqual({ ok: true });
  });

  it('accepts a mix that requests zero from a tier even when the pool is empty for it', () => {
    const pool = [
      { difficulty: 'easy' as const },
      { difficulty: 'easy' as const },
    ];
    expect(checkPoolSufficiency(pool, { easy: 2, medium: 0, hard: 0 })).toEqual({ ok: true });
  });

  it('rejects when the pool is entirely empty and the mix requires questions', () => {
    const result = checkPoolSufficiency([], { easy: 1, medium: 0, hard: 0 });
    expect(result.ok).toBe(false);
  });
});
