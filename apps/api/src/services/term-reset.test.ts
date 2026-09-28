import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

import {
  RESET_CONFIRMATION_PHRASE,
  TERM_RESET_DELETE_ORDER,
  isValidResetConfirmation,
} from './term-reset.js';

describe('isValidResetConfirmation', () => {
  it('accepts only the exact confirmation phrase after trimming', () => {
    expect(isValidResetConfirmation(RESET_CONFIRMATION_PHRASE)).toBe(true);
    expect(isValidResetConfirmation(`  ${RESET_CONFIRMATION_PHRASE}  `)).toBe(true);
    expect(isValidResetConfirmation('RESET TERMS')).toBe(false);
    expect(isValidResetConfirmation('RESET TERM!')).toBe(false);
    expect(isValidResetConfirmation('')).toBe(false);
  });
});

describe('TERM_RESET_DELETE_ORDER', () => {
  it('contains each destructive table once and keeps User last', () => {
    expect(new Set(TERM_RESET_DELETE_ORDER).size).toBe(TERM_RESET_DELETE_ORDER.length);
    expect(TERM_RESET_DELETE_ORDER.at(-1)).toBe('User');
    expect(TERM_RESET_DELETE_ORDER).not.toContain('Subject');
    expect(TERM_RESET_DELETE_ORDER).not.toContain('Permission');
    expect(TERM_RESET_DELETE_ORDER).not.toContain('Admin');
  });
});
