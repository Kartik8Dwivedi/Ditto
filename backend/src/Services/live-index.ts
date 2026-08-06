import { StatusCodes } from 'http-status-codes';

import type IndexerService from './indexer/indexer.service.js';
import type PipelineService from './pipeline.service.js';
import AppConfig from '../Config/AppConfig.js';
import AppError from '../Utils/errors/AppError.js';
import type { StageReporter } from '../Models/index.js';

/**
 * THE ONE CORRECT USE OF pipeline.run: indexing a whole base repo.
 *
 * Shared by two callers so the caps, the hard ceiling, and the extract→pipeline
 * wiring live in exactly one place:
 *   - AnalysisService.runJob — the POST /analyze worker.
 *   - PrService.runPrJob     — the index-if-absent step before a PR check on a
 *                              repo we have never seen.
 *
 * It is deliberately NOT used by the per-PR subset path, which fingerprints only
 * the PR's changed functions and must never call pipeline.run (that wipes the
 * paid index via replaceForRepo).
 */

/**
 * The live caps, read from the environment so full mode (2000/100) and
 * restricted mode (600/20) are an env edit + redeploy apart — never a code
 * change. See AppConfig and docs/ONDEMAND.md. The offline CLI ignores these.
 */
export const LIVE_MAX_FUNCTIONS = AppConfig.LIVE_MAX_FUNCTIONS;
export const LIVE_CANDIDATE_CAP = AppConfig.LIVE_CANDIDATE_CAP;

/** One line naming the mode that is actually live, for the Cloud Run logs. */
export const describeLiveCaps = (): string =>
  `live caps: maxFunctions=${LIVE_MAX_FUNCTIONS} candidateCap=${LIVE_CANDIDATE_CAP} ` +
  `deadline=${Math.round(AppConfig.LIVE_DEADLINE_MS / 1000)}s`;

export interface LiveIndexResult {
  repoId: string;
  functionsTotal: number;
}

export interface LiveIndexOptions {
  indexerService: IndexerService;
  pipelineService: PipelineService;
  owner: string;
  name: string;
  /** Branch/tag/commit, or null/undefined for the default branch. */
  ref?: string | null;
  onStage?: StageReporter;
  /**
   * Fired with the true function count the moment the AST index is known, BEFORE
   * the ceiling check. Lets a caller record `functionsTotal` on its job so an
   * over-limit refusal can still explain the size.
   */
  onExtracted?: (functionsTotal: number) => void;
}

/**
 * Extract a repo, enforce the hard function ceiling, and run the CAPPED pipeline.
 *
 * HARD CEILING, not truncation: a repo over the limit is refused before anything
 * is spent, so a completed live run always has analysed == total (dropping a
 * cluster member makes the cluster silently vanish — worse than an honest no).
 */
export const runLiveIndex = async (options: LiveIndexOptions): Promise<LiveIndexResult> => {
  const { indexerService, pipelineService, owner, name, ref, onStage, onExtracted } = options;

  const extracted = await indexerService.extract({
    owner,
    name,
    branch: ref ?? undefined,
    onStage,
  });
  const functionsTotal = extracted.functions.length;
  onExtracted?.(functionsTotal);

  if (functionsTotal > LIVE_MAX_FUNCTIONS) {
    throw new AppError(
      `This repo has ${functionsTotal} functions, above the current live limit of ` +
        `${LIVE_MAX_FUNCTIONS} — try a smaller repo.`,
      StatusCodes.UNPROCESSABLE_ENTITY
    );
  }

  const report = await pipelineService.run({
    owner,
    name,
    functions: extracted.functions,
    commit: extracted.commit,
    candidateCap: LIVE_CANDIDATE_CAP,
    functionsTotal,
    onStage,
  });

  return { repoId: report.repoId, functionsTotal };
};
