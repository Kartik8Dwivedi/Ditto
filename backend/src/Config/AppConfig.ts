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

  // --- On-demand analysis (see docs/ONDEMAND.md) ---
  // All optional so local `npm run dev` boots WITHOUT Cloud Tasks: when the
  // queue is unconfigured, /analyze runs the job inline (fine for local
  // testing); in production these are set and the job is enqueued instead.
  // TASK_SECRET guards /internal/run — when unset, that route rejects EVERY
  // call (403), so an unconfigured deployment can never be driven anonymously.
  GCP_PROJECT: z.string().min(1).optional(),
  TASKS_LOCATION: z.string().min(1).optional(),
  TASKS_QUEUE: z.string().min(1).optional(),
  // The public base URL of this service, so Cloud Tasks can call it back.
  SERVICE_URL: z.string().url().optional(),
  // Shared secret for the X-Ditto-Task-Secret header on /internal/run.
  TASK_SECRET: z.string().min(1).optional(),

  /**
   * LIVE CAPS — the only knobs separating a rich demo run from a cheap one.
   * Changing mode is an env edit + redeploy, never a code change:
   *
   *   TEST MODE     LIVE_MAX_FUNCTIONS=2000  LIVE_CANDIDATE_CAP=100
   *     Our hero runs: a full analysis comparable to the offline cline run.
   *   JUDGING MODE  LIVE_MAX_FUNCTIONS=300   LIVE_CANDIDATE_CAP=20
   *     Flip to this before judging — protects the API budget when strangers
   *     are pasting URLs. ~₹25-35 per run instead of several hundred.
   *
   * These bound the LIVE path only. The offline CLI pipeline is unaffected and
   * keeps its full-run behaviour.
   */
  LIVE_MAX_FUNCTIONS: z.coerce.number().int().positive().default(2000),
  LIVE_CANDIDATE_CAP: z.coerce.number().int().positive().default(100),
  /**
   * Wall-clock budget for one live run, checked at every stage boundary.
   *
   * Cloud Run kills the request at 1200s; if that happens mid-pipeline the job
   * is never marked done or failed and sticks on "running" forever. Aborting
   * ourselves at 1080s turns that silent hang into an honest failed job with a
   * message, leaving 120s of headroom to write the failure and respond.
   */
  LIVE_DEADLINE_MS: z.coerce.number().int().positive().default(1_080_000),
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
  GCP_PROJECT: env.GCP_PROJECT,
  TASKS_LOCATION: env.TASKS_LOCATION,
  TASKS_QUEUE: env.TASKS_QUEUE,
  SERVICE_URL: env.SERVICE_URL,
  TASK_SECRET: env.TASK_SECRET,
  LIVE_MAX_FUNCTIONS: env.LIVE_MAX_FUNCTIONS,
  LIVE_CANDIDATE_CAP: env.LIVE_CANDIDATE_CAP,
  LIVE_DEADLINE_MS: env.LIVE_DEADLINE_MS,
  // Cloud Tasks is usable only when every piece it needs is present. Off in
  // local dev (→ /analyze runs the job inline); on in a configured deployment.
  TASKS_ENABLED: Boolean(
    env.GCP_PROJECT && env.TASKS_LOCATION && env.TASKS_QUEUE && env.SERVICE_URL && env.TASK_SECRET
  ),
  RateLimiter,
});

export type AppConfigType = typeof AppConfig;

export default AppConfig;
