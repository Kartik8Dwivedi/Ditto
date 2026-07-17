import mongoose from 'mongoose';

import PipelineService from '../Services/pipeline.service.js';
import IntelligenceService from '../Services/intelligence.service.js';
import OpenAIService, { UsageMeter } from '../Services/openai.service.js';
import { connectToDB, disconnectFromDB } from '../Config/db.js';
import logger from '../Config/logger.js';
import type { Fingerprint } from '../Models/contracts.js';

/**
 * End-to-end pipeline verification with the OpenAI client MOCKED.
 *
 * Proves the whole DB-writing path — extractor cache -> fingerprint -> embed ->
 * cluster -> adjudicate -> probe -> Mongo -> read back — against the demo
 * fixture, with real Mongo writes, real deterministic clustering, and REAL
 * execution in the sandbox. Only the two LLM stages are stubbed, so this runs
 * with no API key and no spend. It is a wiring proof, not a data proof; the data
 * proof needs a real key.
 *
 *   npx tsx src/Scripts/verify-pipeline.ts
 */

/** A stub standing in for OpenAIService, deterministic and offline. */
const buildMockOpenAI = (): OpenAIService => {
  const usage = new UsageMeter();

  // Same behaviour -> same fingerprint -> same embed text -> same vector, so the
  // four phone normalisers cluster and the unrelated utilities do not.
  const phone: Fingerprint = {
    intent: 'reduce a phone number to its significant digits',
    inputs: ['string'],
    outputs: ['string'],
    sideEffects: [],
    domain: 'phone-number',
    behavior: ['strip non-digit characters', 'drop a leading country or trunk prefix'],
    pure: true,
  };
  const persist: Fingerprint = {
    intent: 'store a user record',
    inputs: ['object'],
    outputs: ['void'],
    sideEffects: ['writes to a database'],
    domain: 'persistence',
    behavior: ['assign an id', 'insert the record'],
    pure: false,
  };

  const fingerprintFor = (body: string): Fingerprint => {
    if (/replace|digit|slice|substring|charCode|\\D/.test(body) && /return/.test(body) && body.length < 400) {
      return phone;
    }
    if (/insertOne|collection|db\./.test(body)) return persist;
    // Everything else gets a body-derived unique fingerprint so it stays alone.
    return {
      intent: `unique behaviour ${body.length}`,
      inputs: ['string'],
      outputs: ['string'],
      sideEffects: [],
      domain: `misc-${body.length}`,
      behavior: [`step ${body.length}`],
      pure: true,
    };
  };

  const structured = (req: { name: string; user: string; schema: { parse?: unknown } }): Promise<unknown> => {
    usage.record('gpt-5.4-nano', 500, 120);
    if (req.name === 'fingerprint') return Promise.resolve(fingerprintFor(req.user));
    // adjudication
    usage.record('gpt-5.6-terra', 1800, 200);
    return Promise.resolve({
      sameBehavior: true,
      canonicalId: 'fn_1',
      behaviorSummary: 'normalise a phone number to its significant digits',
      differences: ['one keeps the country code, the others strip it'],
      disagreementRisk: 'semantic',
      confidence: 0.95,
      probeInputs: [
        '["9876543210"]',
        '["00919876543210"]',
        '["+91 98765 43210"]',
        '[""]',
        '[null]',
      ],
    });
  };

  // A stable vector per embed text: hash the string to a few dimensions.
  const embed = (texts: string[]): Promise<number[][]> => {
    usage.record('text-embedding-3-small', 50, 0);
    return Promise.resolve(
      texts.map((text) => {
        const v = new Array(16).fill(0);
        for (let i = 0; i < text.length; i += 1) v[i % 16] += text.charCodeAt(i);
        const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / mag);
      })
    );
  };

  return { usage, structured, embed } as unknown as OpenAIService;
};

const main = async (): Promise<void> => {
  await connectToDB();
  try {
    const openai = buildMockOpenAI();
    const report = await new PipelineService({ openai }).run({ owner: 'ditto', name: 'demo' });

    logger.success('pipeline wrote to Mongo. Reading it back...');

    const intelligence = new IntelligenceService();
    const detail = await intelligence.getRepoDetail(report.repoId);

    console.log('\n  STATS (read back from Mongo):');
    console.log('   ', JSON.stringify(detail.stats, null, 2).replace(/\n/g, '\n    '));

    console.log('\n  CLUSTERS:');
    for (const cluster of detail.clusters) {
      console.log(
        `    [${cluster.domain}] ${cluster.behaviorSummary} — ${cluster.memberCount} members, ` +
          `risk=${cluster.disagreementRisk}, provenDivergence=${cluster.hasProvenDivergence}`
      );

      const full = await intelligence.getClusterDetail(cluster.id);
      if (full.divergence?.executed) {
        console.log('      DIVERGENCE TABLE (executed ground truth):');
        for (const row of full.divergence.rows) {
          const mark = row.diverged ? '✕' : '✓';
          const outs = row.results.map((r) => `${r.functionId.slice(-6)}=${r.error ? 'THREW' : r.output}`).join('  ');
          console.log(`        ${mark} ${row.input.padEnd(22)} ${outs}`);
        }
      }
    }

    const conflicts = detail.clusters.filter((c) => c.hasProvenDivergence).length;
    console.log(
      `\n  RESULT: ${detail.stats.semanticDuplicateClusters} clusters, ` +
        `${conflicts} with PROVEN divergence, health ${detail.stats.healthScore}/100`
    );
    if (conflicts === 0) throw new Error('expected at least one proven divergence from the fixture');
    logger.success('end-to-end pipeline verified against the fixture (LLM mocked, Mongo + execution real)');
  } finally {
    // Leave the demo DB clean.
    await mongoose.connection.dropDatabase();
    await disconnectFromDB();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
