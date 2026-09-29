import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PLACEHOLDER = 'change-me-in-production';
const REAL_ENC_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

// The real .env is loaded by the module under test through 'dotenv/config', and dotenv
// never overwrites a variable that is already set, so assigning here wins. Every case
// needs a fresh module registry because the throw happens at import time, not at call time.
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  ACCESS_CODE_ENC_KEY: process.env.ACCESS_CODE_ENC_KEY,
  LAB_IP_RANGES: process.env.LAB_IP_RANGES,
  TRUSTED_PROXY_IPS: process.env.TRUSTED_PROXY_IPS,
};

type BootVars = {
  nodeEnv: string;
  jwtSecret: string;
  accessCodeEncKey?: string;
  labIpRanges?: string;
  trustedProxyIps?: string;
};

async function bootWith(vars: BootVars) {
  process.env.NODE_ENV = vars.nodeEnv;
  process.env.JWT_SECRET = vars.jwtSecret;
  process.env.ACCESS_CODE_ENC_KEY = vars.accessCodeEncKey ?? '';
  process.env.LAB_IP_RANGES = vars.labIpRanges ?? '';
  process.env.TRUSTED_PROXY_IPS = vars.trustedProxyIps ?? '';
  vi.resetModules();
  return import('./env.js');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

    const { env } = await bootWith({
      nodeEnv: 'production',
      jwtSecret: secret,
      accessCodeEncKey: REAL_ENC_KEY,
      labIpRanges: '10.20.0.0/16',
      trustedProxyIps: '10.0.0.5',
    });

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

describe('access code encryption key', () => {
  it('refuses to boot in production when the key is absent', async () => {
    await expect(
      bootWith({
        nodeEnv: 'production',
        jwtSecret: 'k'.repeat(44),
        accessCodeEncKey: '',
        labIpRanges: '10.20.0.0/16',
      }),
    ).rejects.toThrow(/ACCESS_CODE_ENC_KEY/);
  });

  it('refuses to boot in production when the key is not 32 bytes of base64', async () => {
    await expect(
      bootWith({
        nodeEnv: 'production',
        jwtSecret: 'k'.repeat(44),
        accessCodeEncKey: Buffer.from('too short').toString('base64'),
        labIpRanges: '10.20.0.0/16',
      }),
    ).rejects.toThrow(/32 bytes/);
  });

  it('boots in production with a real 32-byte key and exposes it unchanged', async () => {
    const { env } = await bootWith({
      nodeEnv: 'production',
      jwtSecret: 'k'.repeat(44),
      accessCodeEncKey: REAL_ENC_KEY,
      labIpRanges: '10.20.0.0/16',
      trustedProxyIps: '10.0.0.5',
    });

    expect(env.accessCodeEncKey).toBe(REAL_ENC_KEY);
  });

  it('allows an absent key in development so a fresh clone still starts', async () => {
    const { env } = await bootWith({ nodeEnv: 'development', jwtSecret: 'short' });

    expect(env.accessCodeEncKey).toBe('');
  });
});

describe('lab network allowlist', () => {
  it('refuses to boot in production with an empty allowlist', async () => {
    // An empty LAB_IP_RANGES disables the gate entirely, which would let any student on
    // any network sit a doctor exam -- the exact thing spec 6.1 exists to prevent. It is
    // a safe default for development and a silent security hole in production.
    await expect(
      bootWith({
        nodeEnv: 'production',
        jwtSecret: 'k'.repeat(44),
        accessCodeEncKey: REAL_ENC_KEY,
        labIpRanges: '',
      }),
    ).rejects.toThrow(/LAB_IP_RANGES/);
  });

  it('refuses to boot in production when every configured range is unparseable', async () => {
    await expect(
      bootWith({
        nodeEnv: 'production',
        jwtSecret: 'k'.repeat(44),
        accessCodeEncKey: REAL_ENC_KEY,
        labIpRanges: 'not-a-cidr,also-not',
      }),
    ).rejects.toThrow(/LAB_IP_RANGES/);
  });

  it('boots in production with one valid range among the entries', async () => {
    const { env } = await bootWith({
      nodeEnv: 'production',
      jwtSecret: 'k'.repeat(44),
      accessCodeEncKey: REAL_ENC_KEY,
      labIpRanges: 'garbage,10.20.0.0/16',
      trustedProxyIps: '10.0.0.5',
    });

    expect(env.labIpRanges).toEqual(['garbage', '10.20.0.0/16']);
  });

  it('allows an empty allowlist in development', async () => {
    const { env } = await bootWith({ nodeEnv: 'development', jwtSecret: 'short' });

    expect(env.labIpRanges).toEqual([]);
  });
});

describe('trusted proxy allowlist', () => {
  it('refuses to boot in production with an empty TRUSTED_PROXY_IPS', async () => {
    // clientIp() only believes X-Forwarded-For when the immediate peer is one of these.
    // With the list empty, req.ip is the Nginx address for every request, so the whole
    // lab-network gate collapses to "is this the proxy?" for everyone.
    await expect(
      bootWith({
        nodeEnv: 'production',
        jwtSecret: 'k'.repeat(44),
        accessCodeEncKey: REAL_ENC_KEY,
        labIpRanges: '10.20.0.0/16',
        trustedProxyIps: '',
      }),
    ).rejects.toThrow(/TRUSTED_PROXY_IPS/);
  });

  it('boots in production with a trusted proxy configured and exposes it unchanged', async () => {
    const { env } = await bootWith({
      nodeEnv: 'production',
      jwtSecret: 'k'.repeat(44),
      accessCodeEncKey: REAL_ENC_KEY,
      labIpRanges: '10.20.0.0/16',
      trustedProxyIps: '10.0.0.5',
    });

    expect(env.trustedProxyIps).toEqual(['10.0.0.5']);
  });

  it('allows an empty trusted proxy list in development', async () => {
    const { env } = await bootWith({ nodeEnv: 'development', jwtSecret: 'short' });

    expect(env.trustedProxyIps).toEqual([]);
  });
});
