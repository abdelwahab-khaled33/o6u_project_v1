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
