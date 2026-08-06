import CrudRepository from './crud.repository.js';
import { ApiQuotaModel, type IApiQuota, type QuotaBucket } from '../Models/index.js';

/** A Mongo duplicate-key error (unique index violated) — code 11000. */
const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/** Repository for the per-IP/day spend budget. */
class ApiQuotaRepository extends CrudRepository<IApiQuota> {
  constructor() {
    super(ApiQuotaModel);
  }

  /**
   * Atomically charge one unit against `{ip, date, bucket}` if — and only if —
   * the day's count is still below `limit`. Returns true when the unit was
   * charged (request may proceed), false when the budget is spent.
   *
   * The whole check-and-increment is ONE conditional `findOneAndUpdate`:
   *   filter `count < limit` + `$inc count`  →  no read-modify-write window for a
   *   second Cloud Run instance to slip through. That is what makes the hard
   *   budget safe across stateless instances, unlike any in-memory counter.
   *
   * The filter is `count: { $lt: limit }`, so when the day is already at the
   * limit no document matches and the `upsert` tries to INSERT — which the unique
   * index rejects with a duplicate-key error. We treat that as "at limit" and,
   * to distinguish it from the rare concurrent-first-insert race, retry once as a
   * pure update: it succeeds if another instance's insert left us still under the
   * limit, and returns null (denied) if we are genuinely at the ceiling.
   */
  async consume(ip: string, date: string, bucket: QuotaBucket, limit: number): Promise<boolean> {
    if (limit <= 0) return false;

    const filter = { ip, date, bucket, count: { $lt: limit } };
    try {
      const doc = await this.model
        .findOneAndUpdate(
          filter,
          { $inc: { count: 1 }, $setOnInsert: { ip, date, bucket } },
          { upsert: true, new: true }
        )
        .exec();
      return doc !== null;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Either we are at the limit, or another instance won the first insert.
      // A pure update (no upsert) is the tiebreaker: it matches only if the
      // existing row is still under the limit.
      const doc = await this.model
        .findOneAndUpdate(filter, { $inc: { count: 1 } }, { new: true })
        .exec();
      return doc !== null;
    }
  }

  /** Current usage for `{ip, date, bucket}` — 0 when nothing has been charged. */
  async usage(ip: string, date: string, bucket: QuotaBucket): Promise<number> {
    const doc = await this.model.findOne({ ip, date, bucket }).exec();
    return doc?.count ?? 0;
  }
}

export default ApiQuotaRepository;
