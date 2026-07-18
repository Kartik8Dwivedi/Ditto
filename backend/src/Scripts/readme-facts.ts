import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, ClusterRepository } from '../Repository/index.js';
import { FunctionModel } from '../Models/index.js';

/**
 * Re-derives EVERY published number in README.md from Mongo. Read-only, 0 tokens.
 *
 * Run this before judging (or before editing any figure in the docs) so nothing
 * quoted out loud is stale:
 *
 *   npx tsx src/Scripts/readme-facts.ts
 *
 * Prints, in order: the portfolio table, the cluster-count reconciliation
 * (published "duplicate clusters" counts CONFIRMED clusters, not stored docs —
 * they differ, and using the wrong one inflates the headline), and the executed
 * truncateText divergence that the README quotes verbatim.
 */

const main = async (): Promise<void> => {
  await connectToDB();
  try {
    const repos = await new RepoRepository().findAllSnapshots();
    const clusterRepository = new ClusterRepository();

    // ---- the portfolio table, exactly as published ----
    console.log(
      `\nPORTFOLIO\n${'repo'.padEnd(44)} ${'fns'.padStart(6)} ${'clus'.padStart(5)} ${'confl'.padStart(6)} ${'proven'.padStart(7)} ${'health'.padStart(7)} ${'lines'.padStart(6)}`
    );
    console.log('-'.repeat(86));
    let totFns = 0;
    let totProven = 0;
    let totConflicts = 0;
    let totRemovable = 0;
    for (const repo of repos) {
      const clusters = await clusterRepository.findByRepo(repo._id.toString());
      const proven = clusters.filter(
        (c) => c.divergence?.executed === true && c.divergence.rows.some((r) => r.diverged)
      ).length;
      const s = repo.stats;
      console.log(
        `${`${repo.owner}/${repo.name}`.slice(0, 44).padEnd(44)} ${String(s.functions).padStart(6)} ${String(s.semanticDuplicateClusters).padStart(5)} ${String(s.behavioralConflicts).padStart(6)} ${String(proven).padStart(7)} ${String(s.healthScore).padStart(7)} ${String(s.linesRemovable).padStart(6)}`
      );
      totFns += s.functions;
      totProven += proven;
      totConflicts += s.behavioralConflicts;
      totRemovable += s.linesRemovable;
    }
    console.log('-'.repeat(86));
    console.log(
      `${`TOTAL (${repos.length} repos)`.padEnd(44)} ${String(totFns).padStart(6)} ${''.padStart(5)} ${String(totConflicts).padStart(6)} ${String(totProven).padStart(7)} ${''.padStart(7)} ${String(totRemovable).padStart(6)}`
    );

    let sumSemantic = 0;
    let sumStored = 0;
    console.log('\nCLUSTER COUNTING — stats.semanticDuplicateClusters vs stored cluster docs');
    for (const repo of repos) {
      const stored = (await clusterRepository.findByRepo(repo._id.toString())).length;
      sumSemantic += repo.stats.semanticDuplicateClusters;
      sumStored += stored;
      console.log(
        `  ${`${repo.owner}/${repo.name}`.slice(0, 44).padEnd(44)} semantic=${String(repo.stats.semanticDuplicateClusters).padStart(4)}  stored=${String(stored).padStart(4)}  near=${String(repo.stats.nearDuplicates).padStart(3)}  fns=${String(repo.stats.functions).padStart(5)}  health=${String(repo.stats.healthScore).padStart(3)}`
      );
    }
    console.log(`  ${'TOTAL'.padEnd(44)} semantic=${String(sumSemantic).padStart(4)}  stored=${String(sumStored).padStart(4)}`);

    // ---- the truncateText family in cline ----
    const cline = repos.find((r) => r.name === 'cline');
    if (!cline) return;
    const clusters = await clusterRepository.findByRepo(cline._id.toString());

    const allFns = await FunctionModel.find({
      _id: { $in: clusters.flatMap((c) => c.functionIds) },
    })
      .select('name file startLine endLine')
      .lean<Array<{ _id: mongoose.Types.ObjectId; name: string; file: string; startLine: number; endLine: number }>>()
      .exec();
    const byId = new Map(allFns.map((f) => [f._id.toString(), f]));

    console.log(`\n\nEVERY truncateText FUNCTION INDEXED IN cline:`);
    const allTrunc = await FunctionModel.find({ repoId: cline._id, name: 'truncateText' })
      .select('name file startLine endLine isPure')
      .lean<Array<{ name: string; file: string; startLine: number; endLine: number; isPure: boolean }>>()
      .exec();
    for (const t of allTrunc) console.log(`  ${t.file}:${t.startLine}-${t.endLine}  pure=${t.isPure}`);

    console.log(`\n\nCLUSTERS CONTAINING truncateText:`);
    for (const c of clusters) {
      const members = c.functionIds.map((i) => byId.get(i.toString())).filter(Boolean);
      if (!members.some((m) => m!.name === 'truncateText')) continue;

      console.log(`\n  cluster ${c._id.toString()}`);
      console.log(`    summary: ${c.behaviorSummary}`);
      console.log(`    risk=${c.disagreementRisk} confidence=${c.confidence} executed=${c.divergence?.executed}`);
      for (const m of members) console.log(`    member: ${m!.name}() ${m!.file}:${m!.startLine}`);
      const diverged = (c.divergence?.rows ?? []).filter((r) => r.diverged);
      console.log(`    diverged rows: ${diverged.length} of ${c.divergence?.rows.length ?? 0}`);
      for (const row of diverged) {
        console.log(`      input ${row.input}`);
        for (const res of row.results) {
          const fn = byId.get(res.functionId);
          console.log(
            `        ${fn ? `${fn.file}:${fn.startLine}` : res.functionId}  ->  ${res.error ? `ERROR ${res.error}` : JSON.stringify(res.output)}`
          );
        }
      }
    }
    console.log();
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
