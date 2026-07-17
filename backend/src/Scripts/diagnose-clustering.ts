import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, FunctionRepository } from '../Repository/index.js';
import {
  cosineSimilarity,
  findCandidateClusters,
  type ClusterableFunction,
} from '../Services/cluster.service.js';
import logger from '../Config/logger.js';

/**
 * READ-ONLY diagnostic. NO OpenAI calls, NO writes — it reads the embeddings the
 * last pipeline run already persisted and re-runs the (new) clustering over
 * them, so we can confirm BUG 2 is fixed before paying for a re-run.
 *
 * These embeddings were produced with the OLD embed text (behaviour steps
 * included), so this is a CONSERVATIVE test: the new embed text only raises the
 * similarities. If the four truncateText cluster here, they will cluster after
 * re-embedding too.
 *
 *   npx tsx src/Scripts/diagnose-clustering.ts <owner>/<repo>
 */

const main = async (): Promise<void> => {
  const slug = process.argv[2] ?? 'cline/cline';
  const [owner, name] = slug.split('/');

  await connectToDB();
  try {
    const repo = await new RepoRepository().findLatest(owner, name);
    if (!repo) {
      logger.warn(`no indexed snapshot for ${slug} — nothing persisted to read`);
      return;
    }

    const functions = await new FunctionRepository().findByRepo(repo._id.toString());
    const embedded = functions.filter((fn) => fn.embedding && fn.embedding.length > 0);
    logger.info(
      `read ${functions.length} functions, ${embedded.length} with embeddings — 0 OpenAI calls, read-only`
    );

    const truncate = embedded.filter((fn) => fn.name === 'truncateText');
    logger.info(`found ${truncate.length} functions named truncateText`);

    if (truncate.length >= 2) {
      console.log('\n  pairwise cosine of the truncateText embeddings (OLD embed text):');
      let min = 1;
      for (let i = 0; i < truncate.length; i += 1) {
        for (let j = i + 1; j < truncate.length; j += 1) {
          const sim = cosineSimilarity(truncate[i].embedding!, truncate[j].embedding!);
          min = Math.min(min, sim);
          console.log(
            `    ${truncate[i].file.split('/').slice(-1)[0]}:${truncate[i].startLine}  ×  ` +
              `${truncate[j].file.split('/').slice(-1)[0]}:${truncate[j].startLine}  =  ${sim.toFixed(4)}`
          );
        }
      }
      console.log(`    min pair = ${min.toFixed(4)} (user measured 0.6552–0.8916)`);
    }

    const clusterable: ClusterableFunction[] = embedded.map((fn) => ({
      id: fn._id.toString(),
      embedding: fn.embedding!,
      arity: fn.params.length,
      isPure: fn.isPure,
      inputs: fn.fingerprint?.inputs ?? [],
      outputs: fn.fingerprint?.outputs ?? [],
    }));

    const started = Date.now();
    const clusters = findCandidateClusters(clusterable);
    const ms = Date.now() - started;

    const biggest = clusters.reduce((m, c) => Math.max(m, c.memberIds.length), 0);
    logger.info(
      `NEW clustering: ${clusters.length} candidate clusters (largest ${biggest}) ` +
        `over ${clusterable.length} functions in ${ms}ms`
    );

    // Did the four truncateText land together?
    const truncateIds = new Set(truncate.map((fn) => fn._id.toString()));
    const holding = clusters.filter((c) => c.memberIds.some((id) => truncateIds.has(id)));
    console.log(`\n  truncateText landed across ${holding.length} candidate cluster(s):`);
    for (const cluster of holding) {
      const names = cluster.memberIds
        .filter((id) => truncateIds.has(id))
        .map((id) => {
          const fn = truncate.find((f) => f._id.toString() === id)!;
          return `${fn.file.split('/').slice(-1)[0]}:${fn.startLine}`;
        });
      console.log(
        `    cohesion ${cluster.cohesion.toFixed(4)}, ${cluster.memberIds.length} members total, ` +
          `${names.length} of them truncateText: ${names.join(', ')}`
      );
    }

    const together = holding.length === 1 && holding[0].memberIds.filter((id) => truncateIds.has(id)).length === truncate.length;
    if (together) {
      logger.success('all truncateText functions are in ONE candidate cluster — BUG 2 fix confirmed on real vectors');
    } else {
      logger.warn(
        'truncateText did not fully cluster on the OLD (behaviour-laden) embeddings. ' +
          'The new embed text raises similarities; a re-embed (cheap) is needed to confirm.'
      );
    }
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
