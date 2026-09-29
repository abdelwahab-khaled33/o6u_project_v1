import 'dotenv/config';
import { parseCidr } from '../lib/cidr.js';

const required = ['DATABASE_URL', 'JWT_SECRET'] as const;

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  sebKeys: list(process.env.SEB_KEYS),
  labIpRanges: list(process.env.LAB_IP_RANGES),
  // Proxies whose X-Forwarded-For is believed. Empty means believe none of them, which is
  // the only safe default: the header is attacker-controlled unless the socket it arrived
  // on is a host we named ourselves.
  trustedProxyIps: list(process.env.TRUSTED_PROXY_IPS),
  accessCodeEncKey: process.env.ACCESS_CODE_ENC_KEY ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// A shipped placeholder is a token-forgery hole, not a convenience. Anyone who can reach
// the API can sign an admin token with a value that is published in .env.example, so refuse
// to start rather than serve it. Development is exempt on purpose, otherwise a fresh clone
// could not run at all; the placeholder is only a liability where real accounts exist.
if (env.nodeEnv === 'production') {
  if (env.jwtSecret === 'change-me-in-production') {
    throw new Error(
      'JWT_SECRET is still the placeholder "change-me-in-production" from .env.example. ' +
        'Generate a real one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (env.jwtSecret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters in production (got ${env.jwtSecret.length}). ` +
        'Generate a real one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  // These three are read at use, not at boot, so without a guard here the server starts
  // clean, passes /health, and then either silently disables a security control or fails
  // mid-request. A refusal at boot names the variable instead.

  // AES-256-GCM needs exactly 32 key bytes. The same rule access-code.ts enforces at
  // encrypt time, checked here so a bad key is a startup error and not a 500 on the exact
  // moment an admin approves an exam.
  if (!env.accessCodeEncKey) {
    throw new Error(
      'ACCESS_CODE_ENC_KEY is not set. Exam access codes cannot be encrypted without it. ' +
        'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  if (Buffer.from(env.accessCodeEncKey, 'base64').length !== 32) {
    throw new Error(
      'ACCESS_CODE_ENC_KEY must be base64 of exactly 32 bytes. ' +
        'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  // An empty allowlist turns requireLabNetwork into a no-op, so every student on any
  // network could sit a doctor exam. Spec 6.1 exists to prevent exactly that.
  if (env.labIpRanges.length === 0) {
    throw new Error(
      'LAB_IP_RANGES is empty, which disables the lab-network restriction (spec 6.1). ' +
        'Set it to the lab subnets, e.g. LAB_IP_RANGES=10.20.0.0/16,192.168.5.0/24',
    );
  }
  if (env.labIpRanges.every((range) => parseCidr(range) == null)) {
    throw new Error(
      `LAB_IP_RANGES has no valid CIDR in it (got ${JSON.stringify(env.labIpRanges)}), so the ` +
        'lab-network restriction would refuse every student. Use values like 10.20.0.0/16.',
    );
  }

  // With no trusted proxy named, clientIp ignores X-Forwarded-For and reports the Nginx
  // address for every request, so the allowlist above is compared against the proxy itself.
  if (env.trustedProxyIps.length === 0) {
    throw new Error(
      'TRUSTED_PROXY_IPS is empty, so X-Forwarded-For is ignored and every request appears to ' +
        'come from the proxy (spec 6.1). Set it to the reverse proxies, e.g. TRUSTED_PROXY_IPS=10.0.0.5',
    );
  }
}
