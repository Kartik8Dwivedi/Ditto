import mongoose from 'mongoose';

/**
 * PER-IP / PER-DAY spend budget — the hard, multi-instance-safe kill switch.
 *
 * The live paths cost real money (OpenAI + a full index can be minutes of
 * compute), so a hosted, publicly-pasteable API needs a budget that CANNOT be
 * evaded by Cloud Run spinning up a second stateless instance. An in-memory
 * counter per instance is exactly that mistake: five instances = five times the
 * budget. So the counter lives in Mongo, keyed by `{ip, date, bucket}`, and every
 * increment is a single atomic document operation — the DB, shared by every
 * instance, is the one source of truth.
 *
 * `date` is a UTC `YYYY-MM-DD` string, so a new day is simply a new key and the
 * budget "resets" for free with no cron. A TTL index sweeps yesterday's rows.
 *
 * `bucket` separates the tight budgets from the loose ones:
 *   - 'index' — a FULL repo index (POST /analyze, or POST /pr on an unindexed
 *               repo). Expensive; a few per IP per day.
 *   - 'pr'    — a PR check against an ALREADY-indexed repo. Cheap; many per day.
 */
export type QuotaBucket = 'index' | 'pr';

export interface IApiQuota {
  /** Real client IP (behind Cloud Run's proxy — see app.ts `trust proxy`). */
  ip: string;
  /** UTC calendar day, `YYYY-MM-DD`. The daily reset is a change of this key. */
  date: string;
  bucket: QuotaBucket;
  /** Successful consumptions charged to this IP for this bucket today. */
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const apiQuotaSchema = new mongoose.Schema<IApiQuota>(
  {
    ip: { type: String, required: true },
    date: { type: String, required: true },
    bucket: { type: String, enum: ['index', 'pr'], required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

// One counter per (ip, day, bucket). The uniqueness is what makes the atomic
// conditional increment in the repository race-safe across instances.
apiQuotaSchema.index({ ip: 1, date: 1, bucket: 1 }, { unique: true });

// Housekeeping: a day-keyed counter is useless once its day has passed, so let
// Mongo sweep rows two days after creation instead of growing forever.
apiQuotaSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

const ApiQuotaModel = mongoose.model<IApiQuota>('ApiQuota', apiQuotaSchema);

export default ApiQuotaModel;
