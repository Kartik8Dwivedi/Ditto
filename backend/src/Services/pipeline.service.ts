import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { StatusCodes } from 'http-status-codes';

import OpenAIService, { type ModelUsage } from './openai.service.js';
import FingerprintService from './fingerprint.service.js';
import EmbeddingService, { EMBED_VERSION } from './embedding.service.js';
import AdjudicateService, { type AdjudicationMember } from './adjudicate.service.js';
import ProbeService from './probe.service.js';
import { findCandidateClusters, type ClusterableFunction } from './cluster.service.js';
import { computeRepoStats, type StatsCluster } from './stats.service.js';
import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import logger from '../Config/logger.js';
import AppError from '../Utils/errors/AppError.js';
import {
  ExtractorCacheFileSchema,
  type ExtractedFunction,
  type ExtractorCacheFile,
  type ICluster,
  type IFunction,
  type RepoStats,
} from '../Models/index.js';
import type { HydratedDocument } from 'mongoose';

/**
 * THE PIPELINE.
 *
 *   extractor cache -> fingerprint -> embed -> cluster -> adjudicate -> probe -> Mongo
 *
 * Runs locally, never deployed. The API only ever reads what this wrote, which
 * is why a demo costs ₹0 and cannot fail on stage.
 *
 * Note where the money goes: two LLM stages, each seeing exactly one function or
 * one cluster, with everything expensive in between done by arithmetic.
 */

/** Sandboxes are heavy; a few at a time is plenty. */
const PROBE_CONCURRENCY = 4;

/** `backend/.cache/` — resolves the same from `src/` under tsx and `dist/` under node. */
const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../.cache/', import.meta.url));

export interface PipelineOptions {
  owner: string;
  name: string;
  cacheDir?: string;
  /**
   * Hard cap on functions analysed. Deliberately unset by default.
   *
   * A cap is not a safe way to handle a big repo: drop one member of a cluster
   * and the cluster stops forming, so the repo reads as clean rather than as
   * partially analysed. The indexer's cheap filters are how size is managed. If
   * this IS set, every dropped function is named in the log.
   */
  maxFunctions?: number;
}

export interface PipelineReport {
  repoId: string;
  owner: string;
  name: string;
  commit: string;
  functions: number;
  fingerprints: { apiCalls: number; reusedFromCache: number; failed: number };
  embeddings: { embedded: number; reusedFromCache: number };
  candidateClusters: number;
  adjudication: { confirmed: number; rejected: number; failed: number };
  probes: { executed: number; skipped: number; provenDivergences: number };
  stats: RepoStats;
  usage: Record<string, ModelUsage>;
  estimatedUsd: number;
  /** False when a model we used has no listed price — the estimate is a floor. */
  estimateComplete: boolean;
}

interface PipelineServiceDeps {
  openai?: OpenAIService;
  fingerprintService?: FingerprintService;
  embeddingService?: EmbeddingService;
  adjudicateService?: AdjudicateService;
  probeService?: ProbeService;
  repoRepository?: RepoRepository;
  functionRepository?: FunctionRepository;
  clusterRepository?: ClusterRepository;
}

const unwrapCacheFile = (
  data: ExtractorCacheFile
): { functions: ExtractedFunction[]; commit: string } =>
  Array.isArray(data)
    ? { functions: data, commit: 'unknown' }
    : { functions: data.functions, commit: data.commit ?? 'unknown' };

const toClusterable = (doc: HydratedDocument<IFunction>): ClusterableFunction => ({
  id: doc._id.toString(),
  embedding: doc.embedding ?? [],
  arity: doc.params.length,
  isPure: doc.isPure,
  inputs: doc.fingerprint?.inputs ?? [],
  outputs: doc.fingerprint?.outputs ?? [],
  file: doc.file,
});

/** Stable identity for a candidate cluster, so cohesion survives adjudication. */
const clusterKey = (ids: string[]): string => [...ids].sort().join('|');

class PipelineService {
  private readonly openai: OpenAIService;
  private readonly fingerprintService: FingerprintService;
  private readonly embeddingService: EmbeddingService;
  private readonly adjudicateService: AdjudicateService;
  private readonly probeService: ProbeService;
  private readonly repoRepository: RepoRepository;
  private readonly functionRepository: FunctionRepository;
  private readonly clusterRepository: ClusterRepository;

  constructor(deps: PipelineServiceDeps = {}) {
    // One client, one usage meter — otherwise the cost report is a guess.
    const openai = deps.openai ?? new OpenAIService();
    this.openai = openai;
    this.fingerprintService = deps.fingerprintService ?? new FingerprintService({ openai });
    this.embeddingService = deps.embeddingService ?? new EmbeddingService({ openai });
    this.adjudicateService = deps.adjudicateService ?? new AdjudicateService({ openai });
    this.probeService = deps.probeService ?? new ProbeService();
    this.repoRepository = deps.repoRepository ?? new RepoRepository();
    this.functionRepository = deps.functionRepository ?? new FunctionRepository();
    this.clusterRepository = deps.clusterRepository ?? new ClusterRepository();
  }

  async run(options: PipelineOptions): Promise<PipelineReport> {
    const { owner, name, cacheDir = DEFAULT_CACHE_DIR, maxFunctions } = options;

    const extracted = await this.readExtractorCache(owner, name, cacheDir);
    let functions = extracted.functions;
    if (maxFunctions !== undefined && functions.length > maxFunctions) {
      const removed = functions.slice(maxFunctions);
      // Never a silent cap: a cluster missing one member does not degrade, it
      // disappears, and the repo then looks clean instead of half-analysed.
      logger.warn(
        `--max ${maxFunctions} drops ${removed.length} of ${functions.length} functions. ` +
          `Any cluster containing one of these will NOT surface. Dropped:`
      );
      for (const fn of removed) logger.warn(`  dropped ${fn.name} (${fn.file}:${fn.startLine})`);
      functions = functions.slice(0, maxFunctions);
    }
    logger.info(`[1/6] extracted: ${functions.length} functions at commit ${extracted.commit}`);

    const repo = await this.repoRepository.upsertSnapshot(owner, name, extracted.commit);
    const repoId = repo._id.toString();

    // ---- stage 1: fingerprint (cheap model, one function per call) ----
    const cached = await this.functionRepository.findCachedDerivations(
      functions.map((fn) => fn.bodyHash)
    );
    const fingerprints = await this.fingerprintService.fingerprintAll(
      functions,
      new Map(cached.map((row) => [row.bodyHash, row.fingerprint]))
    );
    logger.info(
      `[2/6] fingerprints: ${fingerprints.apiCalls} API calls, ` +
        `${fingerprints.reusedFromCache} reused from cache, ${fingerprints.failed} failed`
    );

    // ---- stage 2: embed the fingerprint, never the code ----
    // Cached embeddings are only reusable if they were built with the CURRENT
    // embed-text recipe. bodyHash is unchanged when the text changes, so without
    // this check a recipe change (like dropping the behaviour steps in v2) would
    // silently reuse stale vectors and reproduce the clustering it was meant to
    // fix. On a version mismatch we ignore the embedding cache and recompute.
    const embedCacheValid = repo.embedVersion === EMBED_VERSION;
    if (!embedCacheValid && repo.embedVersion) {
      logger.warn(
        `embed recipe changed (${repo.embedVersion ?? 'none'} -> ${EMBED_VERSION}) — recomputing all embeddings`
      );
    }
    const embeddings = await this.embeddingService.embedAll(
      fingerprints.byHash,
      embedCacheValid ? new Map(cached.map((row) => [row.bodyHash, row.embedding])) : new Map()
    );
    logger.info(
      `[3/6] embeddings: ${embeddings.embedded} embedded, ${embeddings.reusedFromCache} reused from cache`
    );

    const saved = await this.functionRepository.replaceForRepo(
      repoId,
      functions.map((fn) => ({
        ...fn,
        repoId: repo._id,
        fingerprint: fingerprints.byHash.get(fn.bodyHash),
        embedding: embeddings.byHash.get(fn.bodyHash),
      }))
    );
    // The stored embeddings now match the current recipe — record it so the next
    // run reuses them for free.
    await this.repoRepository.update(repoId, { $set: { embedVersion: EMBED_VERSION } });

    // ---- stage 3: cluster (deterministic, 0 tokens) ----
    const analysable = saved.filter(isAnalysable);
    const candidates = findCandidateClusters(analysable.map(toClusterable));
    // Guard against over-clustering: a generous threshold buys recall at the
    // cost of adjudication calls, so the candidate count and the biggest cluster
    // are logged — each candidate is one flagship call we are about to pay for.
    const biggest = candidates.reduce((max, c) => Math.max(max, c.memberIds.length), 0);
    const toAdjudicate = candidates.reduce((sum, c) => sum + c.memberIds.length, 0);
    logger.info(
      `[4/6] clustering: ${candidates.length} candidate clusters ` +
        `(largest ${biggest} members, ${toAdjudicate} functions to adjudicate) ` +
        `from ${analysable.length} embedded functions — 0 tokens`
    );

    // ---- stage 4: adjudicate (flagship, one cluster per call) ----
    const byId = new Map(saved.map((doc) => [doc._id.toString(), doc]));
    const cohesionByKey = new Map(candidates.map((c) => [clusterKey(c.memberIds), c.cohesion]));

    const memberSets: AdjudicationMember[][] = candidates.map((candidate) =>
      candidate.memberIds.map((id) => {
        const doc = byId.get(id);
        return {
          id,
          body: doc?.body ?? '',
          domain: doc?.fingerprint?.domain ?? 'unknown',
        };
      })
    );

    const adjudicated = await this.adjudicateService.adjudicateAll(memberSets);
    logger.info(
      `[5/6] adjudication: ${adjudicated.clusters.length} confirmed, ` +
        `${adjudicated.rejected} rejected as not-the-same-behaviour, ${adjudicated.failed} failed`
    );

    // ---- stage 5: probe (deterministic, 0 tokens) ----
    const limit = pLimit(PROBE_CONCURRENCY);
    const clusterDocs = await Promise.all(
      adjudicated.clusters.map((cluster) =>
        limit(async (): Promise<Partial<ICluster>> => {
          const members = cluster.memberIds.map((id) => {
            const doc = byId.get(id);
            return { id, body: doc?.body ?? '', isPure: doc?.isPure ?? false };
          });

          const divergence = await this.probeService.probe(members, cluster.probeInputs);

          return {
            repoId: repo._id,
            functionIds: cluster.memberIds.map((id) => byId.get(id)!._id),
            canonicalId: byId.get(cluster.canonicalId)!._id,
            sameBehavior: true,
            behaviorSummary: cluster.behaviorSummary,
            domain: cluster.domain,
            differences: cluster.differences,
            disagreementRisk: cluster.disagreementRisk,
            confidence: cluster.confidence,
            cohesion: cohesionByKey.get(clusterKey(cluster.memberIds)) ?? 0,
            probeInputs: cluster.probeInputs,
            ...(divergence ? { divergence } : {}),
          };
        })
      )
    );

    const executed = clusterDocs.filter((doc) => doc.divergence?.executed).length;
    const provenDivergences = clusterDocs.filter((doc) =>
      doc.divergence?.rows.some((row) => row.diverged)
    ).length;
    logger.info(
      `[6/6] probes: ${executed} clusters executed, ${clusterDocs.length - executed} skipped ` +
        `(too few pure members), ${provenDivergences} with PROVEN divergence — 0 tokens`
    );

    await this.clusterRepository.replaceForRepo(repoId, clusterDocs);

    // ---- stats ----
    const stats = computeRepoStats(
      saved.map((doc) => ({
        id: doc._id.toString(),
        file: doc.file,
        loc: doc.loc,
        isPure: doc.isPure,
        isExported: doc.isExported,
      })),
      clusterDocs.map(toStatsCluster)
    );
    await this.repoRepository.saveStats(repoId, stats);

    return {
      repoId,
      owner,
      name,
      commit: extracted.commit,
      functions: functions.length,
      fingerprints: {
        apiCalls: fingerprints.apiCalls,
        reusedFromCache: fingerprints.reusedFromCache,
        failed: fingerprints.failed,
      },
      embeddings: { embedded: embeddings.embedded, reusedFromCache: embeddings.reusedFromCache },
      candidateClusters: candidates.length,
      adjudication: {
        confirmed: adjudicated.clusters.length,
        rejected: adjudicated.rejected,
        failed: adjudicated.failed,
      },
      probes: { executed, skipped: clusterDocs.length - executed, provenDivergences },
      stats,
      usage: this.openai.usage.snapshot(),
      estimatedUsd: this.openai.usage.estimateUsd(),
      estimateComplete: this.openai.usage.isEstimateComplete(),
    };
  }

  /** Read and validate whatever the extractor left on disk for this repo. */
  private async readExtractorCache(
    owner: string,
    name: string,
    cacheDir: string
  ): Promise<{ functions: ExtractedFunction[]; commit: string }> {
    const file = path.join(cacheDir, `${owner}-${name}.json`);

    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      throw new AppError(
        `No extractor cache at ${file}. Run the indexer for ${owner}/${name} first.`,
        StatusCodes.NOT_FOUND
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new AppError(
        `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        StatusCodes.UNPROCESSABLE_ENTITY
      );
    }

    const parsed = ExtractorCacheFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(
        `${file} does not match the ExtractedFunction contract`,
        StatusCodes.UNPROCESSABLE_ENTITY,
        parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`)
      );
    }

    return unwrapCacheFile(parsed.data);
  }
}

/** Only functions we managed to fingerprint AND embed can be clustered. */
const isAnalysable = (doc: HydratedDocument<IFunction>): boolean =>
  Boolean(doc.fingerprint) && Boolean(doc.embedding?.length);

const toStatsCluster = (doc: Partial<ICluster>): StatsCluster => ({
  functionIds: (doc.functionIds ?? []).map((id) => id.toString()),
  canonicalId: doc.canonicalId?.toString() ?? '',
  confidence: doc.confidence ?? 0,
  disagreementRisk: doc.disagreementRisk ?? 'none',
});

export default PipelineService;
