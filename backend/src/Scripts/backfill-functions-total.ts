import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository } from '../Repository/index.js';
import { FunctionModel } from '../Models/index.js';
import logger from '../Config/logger.js';

/**
 * Backfill `stats.functionsAnalyzed` / `stats.functionsTotal` for repos analysed
 * BEFORE those fields existed, where they default to 0.
 *
 * Those runs were never truncated — the live cap postdates them — so the honest
 * value for both is the number of functions actually stored for the repo. Left
 * at 0 they make `functionsAnalyzed < functionsTotal` read as false in one place
 * and nonsense in another, and the frontend's truncation note keys off exactly
 * that comparison.
 *
 * Read-only apart from the two stats fields. No pipeline, no model calls, ₹0.
 *
 *   npx tsx src/Scripts/backfill-functions-total.ts            # dry run
 *   npx tsx src/Scripts/backfill-functions-total.ts --apply    # write
 */

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  await connectToDB();
  try {
    const repoRepository = new RepoRepository();
    const repos = await repoRepository.findAllSnapshots();

    console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)'}\n${'-'.repeat(78)}`);

    for (const repo of repos) {
      const repoId = repo._id.toString();
      const stored = await FunctionModel.countDocuments({ repoId: repo._id }).exec();
      const s = repo.stats;
      const needsFix = !s.functionsTotal || !s.functionsAnalyzed;

      console.log(
        `${`${repo.owner}/${repo.name}`.slice(0, 40).padEnd(40)} ` +
          `stats.functions=${String(s.functions).padStart(5)}  stored=${String(stored).padStart(5)}  ` +
          `analyzed=${String(s.functionsAnalyzed ?? 0).padStart(5)}  total=${String(s.functionsTotal ?? 0).padStart(5)}` +
          `${needsFix ? '   <- BACKFILL' : ''}`
      );

      if (!needsFix) continue;

      // Trust the documents actually stored for this repo, not the denormalised
      // count — they are the things the map renders.
      if (stored !== s.functions) {
        logger.warn(
          `  ${repo.owner}/${repo.name}: stats.functions=${s.functions} but ${stored} function docs stored; using ${stored}`
        );
      }

      if (apply) {
        await repoRepository.update(repoId, {
          $set: { 'stats.functionsAnalyzed': stored, 'stats.functionsTotal': stored },
        });
        logger.success(`  set functionsAnalyzed = functionsTotal = ${stored}`);
      }
    }
    console.log(`${'-'.repeat(78)}\n`);
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
