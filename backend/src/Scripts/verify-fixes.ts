import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import { FunctionModel } from '../Models/index.js';
import OpenAIService from '../Services/openai.service.js';
import EmbeddingService, { EMBED_VERSION } from '../Services/embedding.service.js';
import AdjudicateService, { type AdjudicationMember } from '../Services/adjudicate.service.js';
import ProbeService from '../Services/probe.service.js';
import { findCandidateClusters, type ClusterableFunction } from '../Services/cluster.service.js';
import logger from '../Config/logger.js';
import type { Fingerprint } from '../Models/contracts.js';

/**
 * CHEAP end-to-end verification of BOTH bug fixes, scoped to the truncateText
 * cluster only, before committing to the full ~₹105 adjudication run.
 *
 * Spends: re-embed all functions with the NEW embed text (embeddings only,
 * ~₹0.15) + ONE flagship adjudication of the truncateText cluster (~₹0.50).
 * Fingerprints are reused from the last run (₹0). Probing is free.
 *
 * Proves:
 *   BUG 2  — the four truncateText land in one candidate cluster
 *   prompt — the adjudicator confirms same_behavior=true with differences noted
 *   money  — the probe produces a divergent row (executed ground truth)
 *   BUG 1  — that cluster, including a divergence table, SAVES to Mongo
 *
 *   npx tsx src/Scripts/verify-fixes.ts
 */

const TARGET_INPUT = '["the quick brown fox jumps", 20]';

const main = async (): Promise<void> => {
  await connectToDB();
  try {
    const repo = await new RepoRepository().findLatest('cline', 'cline');
    if (!repo) throw new Error('cline/cline is not indexed — run the indexer first');
    const repoId = repo._id.toString();

    const functionRepository = new FunctionRepository();
    const repoRepository = new RepoRepository();
    const functions = await functionRepository.findByRepo(repoId);
    const withFingerprints = functions.filter((fn) => fn.fingerprint);
    logger.info(`read ${functions.length} functions (${withFingerprints.length} fingerprinted)`);

    const openai = new OpenAIService();
    const embeddings = new Map<string, number[]>();

    if (repo.embedVersion === EMBED_VERSION) {
      // RESUME: the new embeddings are already persisted. Read them back — no
      // API call, no spend. This is what makes a network blip cost nothing.
      for (const fn of withFingerprints) {
        if (fn.embedding && fn.embedding.length > 0) embeddings.set(fn.bodyHash, fn.embedding);
      }
      logger.success(`resumed: ${embeddings.size} ${EMBED_VERSION} embeddings already in Mongo — 0 spend`);
    } else {
      // ---- re-embed with the NEW embed text (fingerprints reused, ₹0) ----
      const fingerprintByHash = new Map<string, Fingerprint>();
      for (const fn of withFingerprints) {
        if (fn.fingerprint && !fingerprintByHash.has(fn.bodyHash)) {
          fingerprintByHash.set(fn.bodyHash, fn.fingerprint);
        }
      }
      logger.warn(`SPENDING: embedding ${fingerprintByHash.size} unique fingerprints (~₹0.15)...`);
      const result = await new EmbeddingService({ openai }).embedAll(fingerprintByHash);
      for (const [hash, vector] of result.byHash) embeddings.set(hash, vector);

      // Persist in SMALL chunks so a dropped connection loses one batch, not the
      // whole write — and stamp the version only after every chunk landed, so a
      // half-written state never looks complete.
      const ops = [...embeddings].map(([hash, vector]) => ({
        updateMany: { filter: { repoId: repo._id, bodyHash: hash }, update: { $set: { embedding: vector } } },
      }));
      const CHUNK = 200;
      for (let i = 0; i < ops.length; i += CHUNK) {
        await FunctionModel.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
        logger.info(`persisted ${Math.min(i + CHUNK, ops.length)}/${ops.length} embeddings`);
      }
      await repoRepository.update(repoId, { $set: { embedVersion: EMBED_VERSION } });
      logger.success(`persisted all embeddings and stamped ${EMBED_VERSION} — a re-run now costs 0 to embed`);
    }

    // ---- cluster with the new embeddings ----
    const byId = new Map(functions.map((fn) => [fn._id.toString(), fn]));
    const label = (id: string): string => {
      const fn = byId.get(id)!;
      return `${fn.file.split('/').slice(-1)[0]}:${fn.startLine} ${fn.name}`;
    };

    const clusterable: ClusterableFunction[] = withFingerprints
      .filter((fn) => embeddings.has(fn.bodyHash))
      .map((fn) => ({
        id: fn._id.toString(),
        embedding: embeddings.get(fn.bodyHash)!,
        arity: fn.params.length,
        isPure: fn.isPure,
        inputs: fn.fingerprint!.inputs,
        outputs: fn.fingerprint!.outputs,
      }));

    const candidates = findCandidateClusters(clusterable);
    const biggest = candidates.reduce((m, c) => Math.max(m, c.memberIds.length), 0);
    logger.info(`clustering: ${candidates.length} candidates (largest ${biggest})`);

    const truncateIds = new Set(
      functions.filter((fn) => fn.name === 'truncateText').map((fn) => fn._id.toString())
    );
    const holding = candidates.filter((c) => c.memberIds.some((id) => truncateIds.has(id)));

    console.log('\n  #1 CLUSTER SHAPE — every truncateText-containing cluster, in full:');
    for (const c of holding) {
      const n = c.memberIds.filter((id) => truncateIds.has(id)).length;
      console.log(`    ${n}/${truncateIds.size} truncateText, ${c.memberIds.length} members, cohesion ${c.cohesion.toFixed(3)}:`);
      for (const id of c.memberIds) {
        const fn = byId.get(id)!;
        const mark = truncateIds.has(id) ? '► truncateText' : '  OTHER';
        console.log(`        ${mark}  ${fn.file}:${fn.startLine}  ${fn.name}`);
        // For non-truncateText members, show the signature so we can judge
        // whether it is a real truncate-style function or a false positive.
        if (!truncateIds.has(id)) {
          console.log(`              sig: ${fn.signature.replace(/\s+/g, ' ').slice(0, 140)}`);
          console.log(`              intent: ${fn.fingerprint?.intent ?? '(none)'}`);
        }
      }
    }

    // ---- adjudicate BOTH truncateText clusters (so we can report #1 and #2) ----
    const adjudicateService = new AdjudicateService({ openai });
    logger.warn(`SPENDING: ${holding.length} flagship adjudications (~₹0.50 each)...`);

    const savedClusters: Array<Parameters<ClusterRepository['replaceForRepo']>[1][number]> = [];
    let budgetTable: Awaited<ReturnType<ProbeService['probe']>>;
    let budgetIds: string[] = [];

    for (const [i, cluster] of holding.entries()) {
      const members: AdjudicationMember[] = cluster.memberIds.map((id) => ({
        id,
        body: byId.get(id)!.body,
        domain: byId.get(id)!.fingerprint?.domain ?? 'unknown',
      }));

      const adjudicated = await adjudicateService.adjudicate(members);
      console.log(`\n  cluster ${i + 1} (${cluster.memberIds.map(label).join(', ')}):`);
      if (!adjudicated) {
        console.log('    adjudicator kept NO equivalent pair — dropped entirely');
        continue;
      }
      console.log(
        `    KEPT ${adjudicated.memberIds.length}: ${adjudicated.memberIds.map(label).join(', ')}` +
          `${adjudicated.memberIds.length < cluster.memberIds.length ? '  (near-miss dropped)' : ''}`
      );
      console.log(`    sameBehavior=true, risk=${adjudicated.disagreementRisk}, confidence=${adjudicated.confidence}`);
      console.log(`    differences: ${JSON.stringify(adjudicated.differences)}`);

      // ---- probe the equivalent subset (free) ----
      const table = await new ProbeService().probe(
        adjudicated.memberIds.map((id) => ({
          id,
          body: byId.get(id)!.body,
          isPure: byId.get(id)!.isPure,
          preamble: byId.get(id)!.preamble,
        })),
        [...new Set([TARGET_INPUT, ...adjudicated.probeInputs])]
      );

      savedClusters.push({
        repoId: repo._id,
        functionIds: adjudicated.memberIds.map((id) => byId.get(id)!._id),
        canonicalId: byId.get(adjudicated.canonicalId)!._id,
        sameBehavior: true,
        behaviorSummary: adjudicated.behaviorSummary,
        domain: adjudicated.domain,
        differences: adjudicated.differences,
        disagreementRisk: adjudicated.disagreementRisk,
        confidence: adjudicated.confidence,
        cohesion: cluster.cohesion,
        probeInputs: adjudicated.probeInputs,
        ...(table ? { divergence: table } : {}),
      });

      if (adjudicated.memberIds.some((id) => byId.get(id)!.file.includes('budget-projection'))) {
        budgetTable = table;
        budgetIds = adjudicated.memberIds;
      }
    }

    // ---- #4: the divergence row on the target input, budget-projection cluster ----
    if (budgetTable?.executed) {
      const row = budgetTable.rows.find((r) => r.input === TARGET_INPUT);
      console.log(`\n  #4 DIVERGENCE on ${TARGET_INPUT} (budget-projection cluster):`);
      for (const r of row?.results ?? []) {
        const fn = byId.get(r.functionId)!;
        console.log(`    ${fn.file}:${fn.startLine}  ->  ${r.error ? 'THREW ' + r.error : r.output}`);
      }
      console.log(`    diverged: ${row?.diverged}`);
    } else {
      logger.warn(`no executed divergence table for the budget-projection cluster (ids: ${budgetIds.join(', ')})`);
    }

    // ---- #5 / BUG 1: persist the confirmed clusters (including throwing rows) ----
    if (savedClusters.length > 0) {
      await new ClusterRepository().replaceForRepo(repoId, savedClusters);
      const withTables = savedClusters.filter((c) => c.divergence).length;
      logger.success(
        `BUG 1 fixed: ${savedClusters.length} clusters saved to Mongo (${withTables} with divergence tables) — no validation crash`
      );
    } else {
      logger.warn('no clusters confirmed — nothing to save');
    }

    console.log(`\n  spend usage: ${JSON.stringify(openai.usage.snapshot())}`);
    console.log(`  estimated cost: ~$${openai.usage.estimateUsd().toFixed(4)}`);
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
