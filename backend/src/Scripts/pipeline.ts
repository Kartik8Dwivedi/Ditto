import PipelineService, { type PipelineReport } from '../Services/pipeline.service.js';
import { connectToDB, disconnectFromDB } from '../Config/db.js';
import logger from '../Config/logger.js';

/**
 * `npm run pipeline -- <owner>/<repo>`
 *
 * Reads the extractor's cache, runs the full pipeline, and writes the results to
 * Mongo. Runs LOCALLY and is never deployed — which is exactly why the deployed
 * API cannot be asked to clone a repo on a judge's behalf, and why the demo
 * reads from a database instead of a model.
 *
 * A thin CLI adapter: argv in, PipelineService out, no logic of its own.
 */

/**
 * Only used to print the ₹ figure the plan budgets in. Stated here rather than
 * buried, because it is an assumption, not a fact.
 */
const USD_TO_INR = 88;

interface CliArgs {
  owner: string;
  name: string;
  cacheDir?: string;
  maxFunctions?: number;
}

const usage = `Usage: npm run pipeline -- <owner>/<repo> [--cache-dir <path>] [--max <n>]

  <owner>/<repo>     the repo to analyse; reads backend/.cache/<owner>-<repo>.json
  --cache-dir <path> where the extractor wrote its cache (default: backend/.cache)
  --max <n>          cap the number of functions analysed`;

const parseArgs = (argv: string[]): CliArgs => {
  let slug: string | undefined;
  let cacheDir: string | undefined;
  let maxFunctions: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cache-dir') {
      cacheDir = argv[i + 1];
      i += 1;
    } else if (arg === '--max') {
      maxFunctions = Number(argv[i + 1]);
      i += 1;
    } else if (!arg.startsWith('--')) {
      slug ??= arg;
    }
  }

  if (!slug) throw new Error(`Missing <owner>/<repo>.\n\n${usage}`);

  const [owner, name, ...rest] = slug.split('/');
  if (!owner || !name || rest.length > 0) {
    throw new Error(`"${slug}" is not <owner>/<repo>.\n\n${usage}`);
  }
  if (cacheDir === undefined && argv.includes('--cache-dir')) {
    throw new Error(`--cache-dir needs a path.\n\n${usage}`);
  }
  if (maxFunctions !== undefined && (!Number.isInteger(maxFunctions) || maxFunctions < 1)) {
    throw new Error(`--max needs a positive integer.\n\n${usage}`);
  }

  return { owner, name, cacheDir, maxFunctions };
};

const printReport = (report: PipelineReport): void => {
  const {
    stats,
    fingerprints,
    embeddings,
    adjudication,
    probes,
    usage: modelUsage,
    estimatedUsd,
    estimateComplete,
  } = report;

  logger.success(`${report.owner}/${report.name} @ ${report.commit} — done`);

  console.log(`
  INTELLIGENCE MAP
    functions .................. ${stats.functions}
    files ...................... ${stats.files}
    modules .................... ${stats.modules}
    semantic duplicate clusters  ${stats.semanticDuplicateClusters}
    behavioural conflicts ...... ${stats.behavioralConflicts}
    near-duplicates ............ ${stats.nearDuplicates}
    reusable utilities ......... ${stats.reusableUtilities}
    suspected reinvented ....... ${stats.suspectedReinvented}
    lines removable ............ ${stats.linesRemovable}
    call sites unifiable ....... ${stats.callSitesUnifiable}
    HEALTH SCORE ............... ${stats.healthScore}/100

  PIPELINE
    fingerprints ............... ${fingerprints.apiCalls} calls, ${fingerprints.reusedFromCache} cached, ${fingerprints.failed} failed
    embeddings ................. ${embeddings.embedded} embedded, ${embeddings.reusedFromCache} cached
    candidate clusters ......... ${report.candidateClusters}
    adjudicated ................ ${adjudication.confirmed} confirmed, ${adjudication.rejected} rejected, ${adjudication.failed} failed
    probes ..................... ${probes.executed} executed, ${probes.skipped} skipped, ${probes.provenDivergences} PROVEN divergences
`);

  console.log('  COST (tokens are measured; the rupee figure is an estimate)');
  for (const [model, usage] of Object.entries(modelUsage)) {
    console.log(
      `    ${model.padEnd(26)} ${String(usage.calls).padStart(5)} calls  ` +
        `${String(usage.promptTokens).padStart(8)} in  ${String(usage.completionTokens).padStart(7)} out`
    );
  }
  const inr = (estimatedUsd * USD_TO_INR).toFixed(2);
  const qualifier = estimateComplete ? '~' : '≥';
  console.log(
    `    ${'TOTAL'.padEnd(26)} ${qualifier}$${estimatedUsd.toFixed(4)}  (${qualifier}₹${inr} at ₹${USD_TO_INR}/$)`
  );
  if (!estimateComplete) {
    console.log('    note: a model we used has no listed price — this is a floor, not a total.');
  }
  if (fingerprints.apiCalls === 0 && embeddings.embedded === 0) {
    console.log('    every fingerprint and embedding was cached — this run was free.');
  }
  console.log('');
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  await connectToDB();
  try {
    const report = await new PipelineService().run(args);
    printReport(report);
  } finally {
    await disconnectFromDB();
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
