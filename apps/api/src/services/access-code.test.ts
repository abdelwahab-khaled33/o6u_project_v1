import { describe, expect, it } from 'vitest';

process.env.ACCESS_CODE_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

const {
  decryptAccessCode,
  encryptAccessCode,
  evaluateAccessCodeAttempt,
  generateAccessCode,
  hashAccessCode,
  verifyAccessCode,
} = await import('./access-code.js');

describe('access codes', () => {
  it('generates a six-character code from the unambiguous alphabet', () => {
    expect(generateAccessCode()).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });

  it('encrypts and decrypts a code with AES-256-GCM', () => {
    const code = 'ABCD23';

    expect(decryptAccessCode(encryptAccessCode(code))).toBe(code);
  });

  it('verifies the submitted code against its SHA-256 hash', () => {
    const hash = hashAccessCode('ABCD23');

    expect(verifyAccessCode('ABCD23', hash)).toBe(true);
    expect(verifyAccessCode('ABCD24', hash)).toBe(false);
  });

  it('limits incorrect access-code attempts to five per minute', () => {
    const now = new Date('2026-09-27T20:00:00.000Z');
    expect(evaluateAccessCodeAttempt(4, now, now)).toEqual({ limited: false, attempts: 4 });
    expect(evaluateAccessCodeAttempt(5, now, now)).toEqual({ limited: true, attempts: 5 });
    expect(evaluateAccessCodeAttempt(5, now, new Date('2026-09-27T20:01:00.000Z'))).toEqual({
      limited: false,
      attempts: 0,
    });
  });
});
