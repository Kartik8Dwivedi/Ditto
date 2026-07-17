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

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  // Model ids move faster than any codebase. They live here, never in service
  // code: a "model not found" 404 is an env value to change, not a code change.
  // Both verified against OpenAI's docs on 2026-07-17.
  OPENAI_MODEL_CHEAP: z.string().min(1).default('gpt-5.4-nano'),
  OPENAI_MODEL_FLAGSHIP: z.string().min(1).default('gpt-5.6-terra'),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Only used by the local indexer to raise GitHub's anonymous rate limit.
  GITHUB_TOKEN: z.string().optional(),
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
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_MODEL_CHEAP: env.OPENAI_MODEL_CHEAP,
  OPENAI_MODEL_FLAGSHIP: env.OPENAI_MODEL_FLAGSHIP,
  EMBEDDING_MODEL: env.EMBEDDING_MODEL,
  OPENAI_TIMEOUT_MS: env.OPENAI_TIMEOUT_MS,
  GITHUB_TOKEN: env.GITHUB_TOKEN,
  RateLimiter,
});

export type AppConfigType = typeof AppConfig;

export default AppConfig;
