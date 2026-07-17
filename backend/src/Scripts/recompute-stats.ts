import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import { computeRepoStats, type StatsCluster, type StatsFunction } from '../Services/stats.service.js';
import logger from '../Config/logger.js';

/**
 * Recompute an already-indexed repo's Intelligence Map stats from what is
 * already in Mongo, and save them back. NO OpenAI, NO re-clustering — reads the
 * persisted functions and clusters, re-derives the stats (including the health
 * score), and writes the fresh stats onto the repo document.
 *
 * Use it after tuning any stats/health formula, so the demo reflects the new
 * numbers without paying to re-run the pipeline.
 *
 *   npx tsx src/Scripts/recompute-stats.ts <owner>/<repo>
 */

const main = async (): Promise<void> => {
  const slug = process.argv[2] ?? 'cline/cline';
  const [owner, name] = slug.split('/');

  await connectToDB();
  try {
    const repoRepository = new RepoRepository();
    const repo = await repoRepository.findLatest(owner, name);
    if (!repo) throw new Error(`${slug} is not indexed`);
    const repoId = repo._id.toString();

    const [functions, clusters] = await Promise.all([
      new FunctionRepository().findByRepo(repoId),
      new ClusterRepository().findByRepo(repoId),
    ]);

    const statsFunctions: StatsFunction[] = functions.map((fn) => ({
      id: fn._id.toString(),
      file: fn.file,
      loc: fn.loc,
      isPure: fn.isPure,
      isExported: fn.isExported,
    }));
    const statsClusters: StatsCluster[] = clusters.map((cluster) => ({
      functionIds: cluster.functionIds.map((id) => id.toString()),
      canonicalId: cluster.canonicalId.toString(),
      confidence: cluster.confidence,
      disagreementRisk: cluster.disagreementRisk,
    }));

    const stats = computeRepoStats(statsFunctions, statsClusters);
    await repoRepository.saveStats(repoId, stats);

    logger.success(`recomputed stats for ${slug} @ ${repo.commit.slice(0, 7)} (0 tokens)`);
    console.log(`\n  HEALTH SCORE ............... ${stats.healthScore}/100`);
    console.log(`  semantic duplicate clusters  ${stats.semanticDuplicateClusters}`);
    console.log(`  behavioural conflicts ...... ${stats.behavioralConflicts}`);
    console.log(`  near-duplicates ............ ${stats.nearDuplicates}`);
    console.log(`  reusable utilities ......... ${stats.reusableUtilities}`);
    console.log(`  lines removable ............ ${stats.linesRemovable}\n`);
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
