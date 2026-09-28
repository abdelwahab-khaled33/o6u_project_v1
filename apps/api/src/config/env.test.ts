import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PLACEHOLDER = 'change-me-in-production';

// The real .env is loaded by the module under test through 'dotenv/config', and dotenv
// never overwrites a variable that is already set, so assigning here wins. Every case
// needs a fresh module registry because the throw happens at import time, not at call time.
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
};

async function bootWith(vars: { nodeEnv: string; jwtSecret: string }) {
  process.env.NODE_ENV = vars.nodeEnv;
  process.env.JWT_SECRET = vars.jwtSecret;
  vi.resetModules();
  return import('./env.js');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL.JWT_SECRET;
  vi.resetModules();
});

describe('jwt secret configuration', () => {
  it('refuses to boot in production with the placeholder shipped in .env.example', async () => {
    await expect(bootWith({ nodeEnv: 'production', jwtSecret: PLACEHOLDER })).rejects.toThrow(
      /change-me-in-production/,
    );
  });

  it('refuses to boot in production with a secret shorter than 32 characters', async () => {
    await expect(bootWith({ nodeEnv: 'production', jwtSecret: 'a'.repeat(31) })).rejects.toThrow(
      /32 characters/,
    );
  });

  it('boots in production with a real secret and exposes it unchanged', async () => {
    const secret = 'k'.repeat(44);

    const { env } = await bootWith({ nodeEnv: 'production', jwtSecret: secret });

    expect(env.jwtSecret).toBe(secret);
    expect(env.nodeEnv).toBe('production');
  });

  it('allows the placeholder in development so a fresh clone still starts', async () => {
    const { env } = await bootWith({ nodeEnv: 'development', jwtSecret: PLACEHOLDER });

    expect(env.jwtSecret).toBe(PLACEHOLDER);
  });

  it('allows a short secret in development', async () => {
    const { env } = await bootWith({ nodeEnv: 'development', jwtSecret: 'short' });

    expect(env.jwtSecret).toBe('short');
  });

  it('still refuses to boot when JWT_SECRET is missing entirely', async () => {
    process.env.JWT_SECRET = '';
    vi.resetModules();

    await expect(import('./env.js')).rejects.toThrow(/JWT_SECRET/);
  });
});
