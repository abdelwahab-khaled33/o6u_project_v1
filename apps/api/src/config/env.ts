import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET'] as const;

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  sebKeys: (process.env.SEB_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  labIpRanges: (process.env.LAB_IP_RANGES ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),
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
}
