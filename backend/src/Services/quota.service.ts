import { StatusCodes } from 'http-status-codes';

import { ApiQuotaRepository } from '../Repository/index.js';
import AppConfig from '../Config/AppConfig.js';
import AppError from '../Utils/errors/AppError.js';
import type { QuotaBucket } from '../Models/index.js';

/**
 * PER-IP / PER-DAY spend guard for the live, publicly-exposed paths.
 *
 * This REPLACES the old lifetime `LIVE_ANALYSIS_CAP=20` kill switch. That cap was
 * a single global number that one user could exhaust for everyone and that never
 * reset; this is a real quota, charged per client IP per UTC day, backed by an
 * atomic Mongo counter so it holds across multiple stateless Cloud Run instances
 * (see ApiQuotaRepository.consume). The express-rate-limit burst limiter still
 * guards polling/reads on its own terms — this only guards the paid work.
 *
 * Two budgets, both env-configurable (AppConfig):
 *   - 'index' — a full repo index. Expensive → tight (LIVE_INDEX_QUOTA_PER_DAY).
 *   - 'pr'    — a PR check on an already-indexed repo. Cheap → loose
 *               (LIVE_PR_QUOTA_PER_DAY).
 */

/** UTC calendar day, `YYYY-MM-DD` — the daily-reset key. */
export const dayKey = (now: Date): string => now.toISOString().slice(0, 10);

/** No forwarded IP (local curl, a misconfigured proxy) → one shared bucket. */
const normalizeIp = (ip: string | undefined): string => {
  const trimmed = (ip ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
};

interface QuotaServiceDeps {
  quotaRepository?: ApiQuotaRepository;
  /** Injectable clock so a test can prove the by-date reset. */
  now?: () => Date;
}

class QuotaService {
  private readonly quotaRepository: ApiQuotaRepository;
  private readonly now: () => Date;

  constructor({ quotaRepository = new ApiQuotaRepository(), now = () => new Date() }: QuotaServiceDeps = {}) {
    this.quotaRepository = quotaRepository;
    this.now = now;
  }

  /** The configured daily ceiling for a bucket. */
  limitFor(bucket: QuotaBucket): number {
    return bucket === 'index'
      ? AppConfig.LIVE_INDEX_QUOTA_PER_DAY
      : AppConfig.LIVE_PR_QUOTA_PER_DAY;
  }

  /**
   * Charge one unit of `bucket` to `ip` for today. Throws a client-safe 429 when
   * the day's budget is spent; returns quietly (the count already incremented)
   * when the request may proceed. Call this AFTER a dedup/cache short-circuit so a
   * free re-check never touches the budget.
   */
  async consume(ip: string | undefined, bucket: QuotaBucket): Promise<void> {
    const limit = this.limitFor(bucket);
    const date = dayKey(this.now());
    const allowed = await this.quotaRepository.consume(normalizeIp(ip), date, bucket, limit);
    if (!allowed) {
      const what =
        bucket === 'index'
          ? 'full repo analyses/indexes'
          : 'PR checks';
      throw new AppError(
        `Daily limit reached: you have used all ${limit} ${what} allowed per day. ` +
          `This budget protects a shared API key — try again tomorrow, or explore the pre-analysed repos.`,
        StatusCodes.TOO_MANY_REQUESTS
      );
    }
  }
}

export default QuotaService;
