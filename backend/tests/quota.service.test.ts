import { describe, it, expect } from 'vitest';

import QuotaService, { dayKey } from '../src/Services/quota.service.js';
import AppConfig from '../src/Config/AppConfig.js';
import type { QuotaBucket } from '../src/Models/index.js';

/**
 * The per-IP/day spend budget that REPLACED the old lifetime LIVE_ANALYSIS_CAP.
 *
 * These prove the observable contract the app relies on: a bucket blocks once its
 * daily limit is spent, the budget RESETS when the UTC day rolls over, and the
 * INDEX and PR budgets — and different IPs — are independent.
 *
 * The real ApiQuotaRepository does the check-and-increment as a single atomic
 * Mongo op keyed by {ip, date, bucket} (that atomicity is what makes it safe
 * across stateless Cloud Run instances). Here we swap in an in-memory counter
 * with the SAME consume() contract — no prod DB — and drive the clock ourselves
 * to make the by-date reset observable.
 */

/** Faithful stand-in for ApiQuotaRepository: same signature, enforces the limit. */
class InMemoryQuotaRepo {
  private readonly store = new Map<string, number>();

  async consume(ip: string, date: string, bucket: QuotaBucket, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const key = `${ip}|${date}|${bucket}`;
    const current = this.store.get(key) ?? 0;
    if (current >= limit) return false;
    this.store.set(key, current + 1);
    return true;
  }
}

const makeService = (now: () => Date) => {
  const repo = new InMemoryQuotaRepo();
  const service = new QuotaService({ quotaRepository: repo as never, now });
  return { service };
};

const INDEX_LIMIT = AppConfig.LIVE_INDEX_QUOTA_PER_DAY;
const PR_LIMIT = AppConfig.LIVE_PR_QUOTA_PER_DAY;

describe('dayKey', () => {
  it('is the UTC calendar day (YYYY-MM-DD)', () => {
    expect(dayKey(new Date('2026-08-06T23:59:59.000Z'))).toBe('2026-08-06');
    expect(dayKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });
});

describe('QuotaService.consume', () => {
  it('allows exactly the INDEX limit per IP/day, then blocks with a 429', async () => {
    const { service } = makeService(() => new Date('2026-08-06T10:00:00Z'));

    // The first INDEX_LIMIT charges succeed...
    for (let i = 0; i < INDEX_LIMIT; i++) {
      await expect(service.consume('1.2.3.4', 'index')).resolves.toBeUndefined();
    }
    // ...the next one is over budget and is refused with a client-safe message.
    await expect(service.consume('1.2.3.4', 'index')).rejects.toThrow(/Daily limit reached/);
  });

  it('RESETS the budget when the UTC day changes', async () => {
    let clock = new Date('2026-08-06T10:00:00Z');
    const { service } = makeService(() => clock);

    for (let i = 0; i < INDEX_LIMIT; i++) await service.consume('1.2.3.4', 'index');
    await expect(service.consume('1.2.3.4', 'index')).rejects.toThrow(/Daily limit reached/);

    // Roll over to the next UTC day — a new key, a fresh budget, no cron needed.
    clock = new Date('2026-08-07T00:00:01Z');
    await expect(service.consume('1.2.3.4', 'index')).resolves.toBeUndefined();
  });

  it('keeps the INDEX and PR budgets independent', async () => {
    const { service } = makeService(() => new Date('2026-08-06T10:00:00Z'));

    // Exhaust the (tight) INDEX budget...
    for (let i = 0; i < INDEX_LIMIT; i++) await service.consume('1.2.3.4', 'index');
    await expect(service.consume('1.2.3.4', 'index')).rejects.toThrow(/Daily limit reached/);

    // ...the (looser) PR budget for the same IP is untouched.
    await expect(service.consume('1.2.3.4', 'pr')).resolves.toBeUndefined();
    expect(PR_LIMIT).toBeGreaterThan(INDEX_LIMIT);
  });

  it('budgets each IP separately (real client IP behind Cloud Run)', async () => {
    const { service } = makeService(() => new Date('2026-08-06T10:00:00Z'));

    for (let i = 0; i < INDEX_LIMIT; i++) await service.consume('1.1.1.1', 'index');
    await expect(service.consume('1.1.1.1', 'index')).rejects.toThrow(/Daily limit reached/);

    // A different client still has its full budget.
    await expect(service.consume('2.2.2.2', 'index')).resolves.toBeUndefined();
  });

  it('exposes the configured ceilings via limitFor', () => {
    const { service } = makeService(() => new Date());
    expect(service.limitFor('index')).toBe(INDEX_LIMIT);
    expect(service.limitFor('pr')).toBe(PR_LIMIT);
  });
});
