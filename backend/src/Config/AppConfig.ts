import dotenv from 'dotenv';
import { z } from 'zod';

import RateLimiter from './rateLimiter.js';

dotenv.config();

/**
 * Validate and coerce environment variables ONCE at startup. Failing fast here
 * (with a readable message) is far better than discovering a missing/invalid
 * variable deep inside a request later on.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  // Comma-separated list of allowed CORS origins; "*" allows all.
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`❌ Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

/** Frozen, fully-typed application configuration. Nothing else reads process.env. */
const AppConfig = Object.freeze({
  NODE_ENV: env.NODE_ENV,
  IS_PRODUCTION: env.NODE_ENV === 'production',
  PORT: env.PORT,
  MONGO_URI: env.MONGO_URI,
  CORS_ORIGIN: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  RateLimiter,
});

export type AppConfigType = typeof AppConfig;

export default AppConfig;
