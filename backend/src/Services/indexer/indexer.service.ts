import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchRepoFiles } from './github.js';
import { isSourceFile } from './filter.js';
import { extractFromSource } from './extract.js';
import logger from '../../Config/logger.js';
import type { ExtractedFunction } from '../../Models/contracts.js';

/**
 * THE INDEXER — a GitHub repo in, `ExtractedFunction[]` on disk out.
 *
 * Deterministic and free: no model ever runs here. Everything downstream reads
 * the cache this writes, so a re-index is the only thing that costs anything and
 * the pipeline can be re-run against a repo as often as we like.
 *
 * Runs LOCALLY and is never deployed. That is what makes "serverless cannot
 * clone a repo" a non-problem rather than an architecture.
 */

/** `backend/.cache/` — resolves the same from `src/` under tsx and `dist/` under node. */
export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../../.cache/', import.meta.url));

export interface IndexOptions {
  owner: string;
  name: string;
  /** Branch or tag. Defaults to the repo's default branch. */
  branch?: string;
  /** Only index files under this repo-relative directory. */
  scope?: string;
  cacheDir?: string;
  /**
   * Hard cap on functions indexed. NOT set by default, on purpose: dropping one
   * member of a cluster makes the cluster vanish, and a cluster that vanishes is
   * indistinguishable from a repo that is clean. When it is set, every dropped
   * function is named in the log.
   */
  maxFunctions?: number;
}

export interface IndexReport {
  owner: string;
  name: string;
  commit: string;
  scope?: string;
  cacheFile: string;
  filesScanned: number;
  functions: number;
  pureFunctions: number;
  exportedFunctions: number;
  /** Functions the cheap filters removed, grouped by reason. */
  skippedByReason: Record<string, number>;
  dropped: number;
}

export interface CacheFile {
  owner: string;
  name: string;
  commit: string;
  scope?: string;
  indexedAt: string;
  functions: ExtractedFunction[];
}

export const cacheFileFor = (owner: string, name: string, cacheDir = DEFAULT_CACHE_DIR): string =>
  path.join(cacheDir, `${owner}-${name}.json`);

class IndexerService {
  async run(options: IndexOptions): Promise<IndexReport> {
    const { owner, name, branch, scope, cacheDir = DEFAULT_CACHE_DIR, maxFunctions } = options;

    logger.info(
      `fetching ${owner}/${name}${branch ? `@${branch}` : ''}${scope ? ` (scope: ${scope})` : ''}...`
    );
    const repo = await fetchRepoFiles({ owner, name, branch, scope, accept: isSourceFile });
    logger.info(`[1/2] fetched ${repo.files.size} source files at commit ${repo.commit.slice(0, 7)}`);

    for (const entry of repo.skipped) {
      logger.warn(`skipped ${entry.file}: ${entry.reason}`);
    }

    let functions: ExtractedFunction[] = [];
    const skippedByReason: Record<string, number> = {};
    const failed: string[] = [];

    for (const [file, contents] of repo.files) {
      try {
        const result = extractFromSource(file, contents);
        functions.push(...result.functions);
        for (const skip of result.skipped) {
          skippedByReason[skip.reason] = (skippedByReason[skip.reason] ?? 0) + 1;
        }
      } catch (err) {
        // One unparseable file must not cost us the repo.
        failed.push(file);
        logger.warn(`could not parse ${file}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Stable order: same repo, same commit, same file on disk.
    functions.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);

    let dropped = 0;
    if (maxFunctions !== undefined && functions.length > maxFunctions) {
      const removed = functions.slice(maxFunctions);
      dropped = removed.length;
      // Never a silent cap. If a cluster is missing a member, the reason has to
      // be in this log rather than a mystery on stage.
      logger.warn(
        `--max ${maxFunctions} dropped ${dropped} of ${functions.length} functions. ` +
          `A cluster missing one of these members will NOT surface. Dropped:`
      );
      for (const fn of removed) logger.warn(`  dropped ${fn.name} (${fn.file}:${fn.startLine})`);
      functions = functions.slice(0, maxFunctions);
    }

    logger.info(
      `[2/2] extracted ${functions.length} functions ` +
        `(${functions.filter((fn) => fn.isPure).length} pure) from ${repo.files.size} files`
    );

    const cacheFile = cacheFileFor(owner, name, cacheDir);
    const payload: CacheFile = {
      owner,
      name,
      commit: repo.commit,
      ...(scope ? { scope } : {}),
      indexedAt: new Date().toISOString(),
      functions,
    };
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify(payload, null, 2)}\n`);

    return {
      owner,
      name,
      commit: repo.commit,
      ...(scope ? { scope } : {}),
      cacheFile,
      filesScanned: repo.files.size,
      functions: functions.length,
      pureFunctions: functions.filter((fn) => fn.isPure).length,
      exportedFunctions: functions.filter((fn) => fn.isExported).length,
      skippedByReason,
      dropped,
    };
  }
}

export default IndexerService;
