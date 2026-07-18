import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import { FunctionModel } from '../Models/index.js';
import IntelligenceService from '../Services/intelligence.service.js';

/**
 * Profile GET /repos/:id stage by stage. Read-only, 0 tokens.
 *
 *   npx tsx src/Scripts/profile-repo-detail.ts <repoId>
 */

const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  const size = Buffer.byteLength(JSON.stringify(result ?? null));
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(6)}ms   ${(size / 1024 / 1024).toFixed(2)} MB`);
  return result;
};

const main = async (): Promise<void> => {
  const repoId = process.argv[2] ?? '6a5a506029d58c7241f1fd90';
  await connectToDB();
  try {
    const repoRepository = new RepoRepository();
    const functionRepository = new FunctionRepository();
    const clusterRepository = new ClusterRepository();

    console.log(`\nprofiling repo ${repoId}\n${'-'.repeat(78)}`);

    await time('repoRepository.findByIdOrFail', () => repoRepository.findByIdOrFail(repoId));
    const fns = await time('functionRepository.findByRepo  [CURRENT]', () =>
      functionRepository.findByRepo(repoId)
    );
    const clusters = await time('clusterRepository.findByRepo', () =>
      clusterRepository.findByRepo(repoId)
    );
    console.log(`  -> ${fns.length} functions, ${clusters.length} clusters`);

    console.log(`\n  candidate replacements for the functions query:`);
    await time('find({repoId}).select(loc).lean()  [PROPOSED]', () =>
      FunctionModel.find({ repoId }).select('loc').lean().exec()
    );
    await time('find({repoId}).select(loc) (hydrated)', () =>
      FunctionModel.find({ repoId }).select('loc').exec()
    );

    console.log(`\n  end-to-end:`);
    const service = new IntelligenceService();
    await time('IntelligenceService.getRepoDetail', () => service.getRepoDetail(repoId));
    await time('IntelligenceService.getRepoDetail (warm)', () => service.getRepoDetail(repoId));

    console.log(`${'-'.repeat(78)}\n`);
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
