import IndexerService, { type IndexReport } from '../Services/indexer/indexer.service.js';
import logger from '../Config/logger.js';

/**
 * `npm run index -- <owner>/<repo> [--scope <path>] [--branch <name>]`
 *
 * Fetches a repo's tarball, walks every file's AST, and writes
 * `backend/.cache/<owner>-<repo>.json` for the pipeline to read.
 *
 * Runs LOCALLY, never deployed, and never calls a model — re-indexing costs
 * nothing but bandwidth.
 */

interface CliArgs {
  owner: string;
  name: string;
  branch?: string;
  scope?: string;
  cacheDir?: string;
  maxFunctions?: number;
  grep?: string;
}

const usage = `Usage: npm run index -- <owner>/<repo> [options]

  <owner>/<repo>       the public repo to index
  --scope <path>       only index files under this repo-relative directory
  --branch <name>      branch or tag to index (default: the repo's default branch)
  --cache-dir <path>   where to write the cache (default: backend/.cache)
  --max <n>            cap functions indexed. NOT set by default — a cap can hide
                       a cluster member. Everything dropped is named in the log.
  --grep <text>        after indexing, print every function whose name matches

Examples:
  npm run index -- cline/cline --scope sdk/packages/core
  npm run index -- actualbudget/actual --branch master --scope packages/loot-core/src`;

const parseArgs = (argv: string[]): CliArgs => {
  const flags = new Map<string, string>();
  let slug: string | undefined;

  const takesValue = new Set(['--scope', '--branch', '--cache-dir', '--max', '--grep']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value.\n\n${usage}`);
      }
      flags.set(arg, value);
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}.\n\n${usage}`);
    } else {
      slug ??= arg;
    }
  }

  if (!slug) throw new Error(`Missing <owner>/<repo>.\n\n${usage}`);
  const [owner, name, ...rest] = slug.split('/');
  if (!owner || !name || rest.length > 0) {
    throw new Error(`"${slug}" is not <owner>/<repo>.\n\n${usage}`);
  }

  const rawMax = flags.get('--max');
  const maxFunctions = rawMax === undefined ? undefined : Number(rawMax);
  if (maxFunctions !== undefined && (!Number.isInteger(maxFunctions) || maxFunctions < 1)) {
    throw new Error(`--max needs a positive integer.\n\n${usage}`);
  }

  return {
    owner,
    name,
    branch: flags.get('--branch'),
    scope: flags.get('--scope'),
    cacheDir: flags.get('--cache-dir'),
    maxFunctions,
    grep: flags.get('--grep'),
  };
};

const printReport = (report: IndexReport): void => {
  logger.success(`${report.owner}/${report.name} @ ${report.commit.slice(0, 7)} — indexed`);
  console.log(`
  files scanned .............. ${report.filesScanned}
  functions extracted ........ ${report.functions}
    pure ..................... ${report.pureFunctions}
    exported ................. ${report.exportedFunctions}
    private (not exported) ... ${report.functions - report.exportedFunctions}
  cache ...................... ${report.cacheFile}`);

  const skipped = Object.entries(report.skippedByReason);
  if (skipped.length > 0) {
    console.log('\n  filtered out before any model saw them (0 tokens):');
    for (const [reason, count] of skipped.sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(5)} ${reason}`);
    }
  }
  if (report.dropped > 0) {
    console.log(`\n  ⚠ ${report.dropped} functions dropped by --max; see the warnings above.`);
  }
  console.log('');
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const report = await new IndexerService().run(args);
  printReport(report);

  if (args.grep) {
    const { readFile } = await import('node:fs/promises');
    const cache = JSON.parse(await readFile(report.cacheFile, 'utf8')) as {
      functions: Array<{ name: string; file: string; startLine: number; isPure: boolean; isExported: boolean }>;
    };
    const needle = args.grep.toLowerCase();
    const matches = cache.functions.filter((fn) => fn.name.toLowerCase().includes(needle));

    console.log(`  --grep "${args.grep}" matched ${matches.length} function(s):`);
    for (const fn of matches) {
      console.log(
        `    ${fn.file}:${fn.startLine}  ${fn.name}  isPure=${fn.isPure}  isExported=${fn.isExported}`
      );
    }
    console.log('');
  }
};

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
