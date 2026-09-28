import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function encryptionKey(): Buffer {
  const key = Buffer.from(env.accessCodeEncKey, 'base64');
  if (key.length !== 32) {
    throw new Error('ACCESS_CODE_ENC_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

export function generateAccessCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ACCESS_CODE_ALPHABET[crypto.randomInt(ACCESS_CODE_ALPHABET.length)];
  }
  return code;
}

export function hashAccessCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function verifyAccessCode(code: string, hash: string): boolean {
  const submitted = Buffer.from(hashAccessCode(code), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
}

export function evaluateAccessCodeAttempt(
  wrongAttempts: number,
  windowStartedAt: Date | null,
  now: Date,
): { limited: boolean; attempts: number } {
  const withinWindow =
    windowStartedAt != null && now.getTime() - windowStartedAt.getTime() < 60_000;
  const attempts = withinWindow ? wrongAttempts : 0;
  return { limited: attempts >= 5, attempts };
}

export function encryptAccessCode(code: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptAccessCode(encrypted: string): string {
  const payload = Buffer.from(encrypted, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createAccessCodeData() {
  const code = generateAccessCode();
  return {
    code,
    access_code_hash: hashAccessCode(code),
    access_code_encrypted: encryptAccessCode(code),
  };
}
