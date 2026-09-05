import { StatusCodes } from 'http-status-codes';

import FingerprintService from './fingerprint.service.js';
import EmbeddingService, { EMBED_VERSION } from './embedding.service.js';
import AdjudicateService from './adjudicate.service.js';
import ProbeService from './probe.service.js';
import IndexerService from './indexer/indexer.service.js';
import PipelineService from './pipeline.service.js';
import TasksService from './tasks.service.js';
import QuotaService from './quota.service.js';
import { runLiveIndex } from './live-index.js';
import {
  cosineSimilarity,
  isCompatible,
  findCandidateClusters,
  type ClusterableFunction,
} from './cluster.service.js';
import { CONFIDENCE_THRESHOLD, moduleOf } from './stats.service.js';
import { fetchRepoFiles, type FetchOptions, type FetchedRepo } from './indexer/github.js';
import {
  changedSourceRanges,
  selectChangedFunctions,
  type ChangedFileInput,
} from './pr/diff.js';
import HttpGithubPrClient, { type GithubPrClient, type PullMeta } from './pr/github-pr.js';
import {
  RepoRepository,
  FunctionRepository,
  ClusterRepository,
  JobRepository,
  PrAnalysisRepository,
} from '../Repository/index.js';
import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';
import { ConflictError } from '../Utils/errors/AppError.js';
import AppError from '../Utils/errors/AppError.js';
import type {
  ExtractedFunction,
  IFunction,
  IRepo,
  IPrAnalysis,
  PrFinding,
  PrAnalysis,
  StageReporter,
} from '../Models/index.js';
import type { HydratedDocument } from 'mongoose';

/**
 * PER-PR ANALYSIS — Ditto's flagship "did this PR reinvent something?" check.
 *
 * NON-DESTRUCTIVE by construction: it composes the same services the pipeline
 * uses but NEVER calls pipeline.run (which wipes the repo index via
 * replaceForRepo). It fingerprints ONLY the PR's changed functions, searches the
 * repo's already-paid-for index by cosine, adjudicates the best pair, and — the
 * differentiator — when both sides are pure, EXECUTES them in the sandbox to
 * prove divergence rather than merely assert it. The PR's functions are stored
 * inline on a self-contained PrAnalysis, never inserted into the paid index.
 *
 * `proof` is set honestly: 'executed' only when the sandbox really ran a pure
 * pair, 'suspected' for a confirmed-but-impure match, 'none' for a novel one.
 */

/** Below this cosine we do not pay the flagship — the change is 'novel'. */
export const PR_SEARCH_FLOOR = 0.8;

/** What the caller resolved from a URL or body. */
export interface PrAnalyzeInput {
  owner: string;
  name: string;
  /** Omitted → the repo's latest open PR. */
  prNumber?: number;
}

/** The result of submitting a PR: either a job to poll, or a dedup'd analysis. */
export interface PrSubmitResult {
  jobId: string | null;
  prAnalysisId: string | null;
}

type RepoFileFetcher = (options: FetchOptions) => Promise<FetchedRepo>;

interface PrServiceDeps {
  repoRepository?: RepoRepository;
  functionRepository?: FunctionRepository;
  clusterRepository?: ClusterRepository;
  jobRepository?: JobRepository;
  prAnalysisRepository?: PrAnalysisRepository;
  fingerprintService?: FingerprintService;
  embeddingService?: EmbeddingService;
  adjudicateService?: AdjudicateService;
  probeService?: ProbeService;
  githubPr?: GithubPrClient;
  /** Injectable for tests — the real one hits GitHub's tarball endpoint. */
  fetchRepoFiles?: RepoFileFetcher;
  /** Index-if-absent (Stage B): the base-repo indexer + pipeline. */
  indexerService?: IndexerService;
  pipelineService?: PipelineService;
  /** Async queueing + per-IP/day spend budget for the public path. */
  tasksService?: TasksService;
  quotaService?: QuotaService;
}

const round = (value: number): number => Math.round(value * 100) / 100;

const toClusterable = (doc: HydratedDocument<IFunction>): ClusterableFunction => ({
  id: doc._id.toString(),
  embedding: doc.embedding ?? [],
  arity: doc.params.length,
  isPure: doc.isPure,
  inputs: doc.fingerprint?.inputs ?? [],
  outputs: doc.fingerprint?.outputs ?? [],
  file: doc.file,
});

/** Nearest compatible neighbour by cosine — the same search Guard runs. */
const findBestMatch = (
  probe: ClusterableFunction,
  index: ClusterableFunction[]
): { id: string; similarity: number } | null => {
  let best: { id: string; similarity: number } | null = null;
  for (const candidate of index) {
    if (!isCompatible(probe, candidate)) continue;
    const similarity = cosineSimilarity(probe.embedding, candidate.embedding);
    if (!best || similarity > best.similarity) best = { id: candidate.id, similarity };
  }
  return best;
};

const novelFinding = (fn: ExtractedFunction, similarity: number): PrFinding => ({
  newFunction: { name: fn.name, file: fn.file, startLine: fn.startLine, endLine: fn.endLine },
  match: null,
  verdict: 'novel',
  similarity: round(similarity),
  confidence: 0,
  usedBy: [],
  divergence: null,
  proof: 'none',
});

class PrService {
  private readonly repoRepository: RepoRepository;
  private readonly functionRepository: FunctionRepository;
  private readonly clusterRepository: ClusterRepository;
  private readonly jobRepository: JobRepository;
  private readonly prAnalysisRepository: PrAnalysisRepository;
  private readonly fingerprintService: FingerprintService;
  private readonly embeddingService: EmbeddingService;
  private readonly adjudicateService: AdjudicateService;
  private readonly probeService: ProbeService;
  private readonly githubPr: GithubPrClient;
  private readonly fetchRepoFiles: RepoFileFetcher;
  private readonly indexerService: IndexerService;
  private readonly pipelineService: PipelineService;
  private readonly tasksService: TasksService;
  private readonly quotaService: QuotaService;

  constructor({
    repoRepository = new RepoRepository(),
    functionRepository = new FunctionRepository(),
    clusterRepository = new ClusterRepository(),
    jobRepository = new JobRepository(),
    prAnalysisRepository = new PrAnalysisRepository(),
    fingerprintService = new FingerprintService(),
    embeddingService = new EmbeddingService(),
    adjudicateService = new AdjudicateService(),
    probeService = new ProbeService(),
    githubPr = new HttpGithubPrClient(),
    fetchRepoFiles: fetcher = fetchRepoFiles,
    indexerService = new IndexerService(),
    pipelineService = new PipelineService(),
    tasksService = new TasksService(),
    quotaService = new QuotaService(),
  }: PrServiceDeps = {}) {
    this.repoRepository = repoRepository;
    this.functionRepository = functionRepository;
    this.clusterRepository = clusterRepository;
    this.jobRepository = jobRepository;
    this.prAnalysisRepository = prAnalysisRepository;
    this.fingerprintService = fingerprintService;
    this.embeddingService = embeddingService;
    this.adjudicateService = adjudicateService;
    this.probeService = probeService;
    this.githubPr = githubPr;
    this.fetchRepoFiles = fetcher;
    this.indexerService = indexerService;
    this.pipelineService = pipelineService;
    this.tasksService = tasksService;
    this.quotaService = quotaService;
  }

  /**
   * Submit a PR for analysis. Works on ANY public repo now (Stage B), and is safe
   * to expose publicly.
   *
   *   1. Resolve the PR head SHA (the dedup key + the code the PR proposes).
   *   2. CACHE SHORT-CIRCUIT: a re-check of the same head SHA returns the stored
   *      analysis for ₹0 — before any quota is charged and before any expensive
   *      GitHub/OpenAI work.
   *   3. If the base repo is ALREADY indexed → the fast SYNCHRONOUS Stage-A path:
   *      charge the loose per-IP/day PR budget, check the PR inline, return the
   *      finished analysis.
   *   4. If the base repo is NOT indexed → the async INDEX-IF-ABSENT path: charge
   *      the tight per-IP/day INDEX budget, queue a job that first indexes the
   *      base repo then checks the PR. Returns `{ jobId }` to poll; the ONE
   *      GET /jobs/:id endpoint drives it, and on `done` sets `prAnalysisId`.
   *
   * `ip` is the real client IP (req.ip, correct behind Cloud Run's proxy). It
   * keys the quota. The dedup hit is charged nothing.
   */
  async submit(input: PrAnalyzeInput, ip?: string): Promise<PrSubmitResult> {
    // resolvePull is a single cheap, disk-cached GitHub metadata call — the
    // minimum needed to compute the dedup key. The expensive fetches (changed
    // files, PR-head tarball) and every OpenAI call come strictly AFTER the cache
    // check and the quota charge below.
    const meta = await this.githubPr.resolvePull(input.owner, input.name, input.prNumber);

    // CACHE by head SHA: the same code proposed again is the same answer. Returns
    // BEFORE any quota is consumed and before any changed-file/tarball/OpenAI work.
    const cached = await this.prAnalysisRepository.findByHeadSha(meta.headSha);
    if (cached) {
      logger.info(`PR dedup hit for ${input.owner}/${input.name} @ ${meta.headSha.slice(0, 7)}`);
      return { jobId: null, prAnalysisId: cached._id.toString() };
    }

    const repo = await this.repoRepository.findLatest(input.owner, input.name);

    // ---- FAST SYNC PATH (Stage A): base repo already indexed ----
    if (repo) {
      // A PR check on an existing index is cheap — the loose PR budget.
      await this.quotaService.consume(ip, 'pr');

      const job = await this.jobRepository.create({
        owner: input.owner,
        name: input.name,
        ref: meta.headRef,
        status: 'running',
        stage: 'fetch',
        pr: this.prBlock(meta, false),
      });
      const jobId = job._id.toString();

      try {
        const onStage: StageReporter = (stage) => this.jobRepository.setStage(jobId, stage);
        const analysis = await this.analyze(repo, meta, onStage);
        await this.jobRepository.setPrChangedFunctions(jobId, analysis.changedFunctions);
        await this.jobRepository.markPrDone(jobId, analysis._id);
        logger.success(
          `PR analysis done for ${input.owner}/${input.name} #${meta.prNumber} → ` +
            `${analysis.findings.length} findings on ${analysis.changedFunctions} changed functions`
        );
        return { jobId, prAnalysisId: analysis._id.toString() };
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'PR analysis failed unexpectedly.';
        await this.jobRepository.markFailed(jobId, message);
        throw err;
      }
    }

    // ---- ASYNC INDEX-IF-ABSENT PATH (Stage B): never seen this repo ----
    // A full index can take minutes, so this is a queued job, not a blocking
    // response. Charge the tight INDEX budget (a full index is the expensive one).
    await this.quotaService.consume(ip, 'index');

    const job = await this.jobRepository.create({
      owner: input.owner,
      name: input.name,
      // Index the repo's DEFAULT branch (null), like /analyze — the PR-head code
      // is fetched separately by headSha inside analyze(). Reusable by later checks.
      ref: null,
      status: 'queued',
      stage: 'queued',
      pr: this.prBlock(meta, true),
    });
    const jobId = job._id.toString();

    if (this.tasksService.isEnabled()) {
      await this.tasksService.enqueueRun(jobId);
    } else {
      // Local fallback: no Cloud Tasks configured, so run the job in-process.
      logger.warn(`Cloud Tasks not configured — running PR job ${jobId} inline (local fallback)`);
      void this.runPrJob(jobId);
    }

    return { jobId, prAnalysisId: null };
  }

  /** The PR metadata block stored on a job. */
  private prBlock(meta: PullMeta, indexedOnDemand: boolean): {
    prNumber: number;
    headSha: string;
    baseSha: string;
    headRef: string;
    changedFunctions: number;
    indexedOnDemand: boolean;
  } {
    return {
      prNumber: meta.prNumber,
      headSha: meta.headSha,
      baseSha: meta.baseSha,
      headRef: meta.headRef,
      changedFunctions: 0,
      indexedOnDemand,
    };
  }

  /**
   * The async worker for an INDEX-IF-ABSENT PR job (Stage B). Cloud Tasks pushes
   * it here via AnalysisService.runJob (which delegates any job carrying a `pr`
   * block). It (1) indexes the base repo — the ONE correct use of pipeline.run —
   * then (2) runs the PR check against that fresh index, driving the SAME job
   * stages the poll renders and setting `prAnalysisId` on completion.
   *
   * Never throws: a failure becomes a `failed` job with a client-safe reason, so
   * Cloud Tasks sees success and does not retry (which would re-spend).
   */
  async runPrJob(jobId: string): Promise<void> {
    const job = await this.jobRepository.findById(jobId);
    if (!job || !job.pr) {
      logger.error(`runPrJob: no PR job ${jobId}`);
      return;
    }

    logger.info(
      `PR job ${jobId} (${job.owner}/${job.name} #${job.pr.prNumber}) — index-if-absent, then check`
    );

    const startedAt = Date.now();
    const elapsedMs = (): number => Date.now() - startedAt;
    const onStage: StageReporter = async (stage) => {
      if (elapsedMs() > AppConfig.LIVE_DEADLINE_MS) {
        throw new AppError(
          `Analysis exceeded the ${Math.round(AppConfig.LIVE_DEADLINE_MS / 1000)}s live time budget ` +
            `at the "${stage}" stage. Try a smaller repo.`,
          StatusCodes.REQUEST_TIMEOUT
        );
      }
      await this.jobRepository.setStage(jobId, stage);
    };

    try {
      await this.jobRepository.markRunning(jobId);

      // 1. INDEX the base repo (extract → hard ceiling → capped pipeline.run).
      const { repoId } = await runLiveIndex({
        indexerService: this.indexerService,
        pipelineService: this.pipelineService,
        owner: job.owner,
        name: job.name,
        ref: job.ref,
        onStage,
      });
      const repo = await this.repoRepository.findById(repoId);
      if (!repo) {
        throw new AppError(
          'The freshly indexed repo could not be loaded for the PR check.',
          StatusCodes.INTERNAL_SERVER_ERROR
        );
      }

      // 2. CHECK the PR against the fresh index. prUrl is the canonical PR URL,
      //    reconstructed so the worker needs no extra GitHub call.
      const meta: PullMeta = {
        prNumber: job.pr.prNumber,
        headSha: job.pr.headSha,
        baseSha: job.pr.baseSha,
        headRef: job.pr.headRef,
        prUrl: `https://github.com/${job.owner}/${job.name}/pull/${job.pr.prNumber}`,
      };
      const analysis = await this.analyze(repo, meta, onStage);
      await this.jobRepository.setPrChangedFunctions(jobId, analysis.changedFunctions);
      await this.jobRepository.markPrDone(jobId, analysis._id);
      logger.success(
        `PR job ${jobId} done for ${job.owner}/${job.name} #${job.pr.prNumber} → ` +
          `${analysis.findings.length} findings on ${analysis.changedFunctions} changed functions`
      );
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'PR analysis failed unexpectedly.';
      logger.error(`PR job ${jobId} failed: ${err instanceof Error ? err.message : err}`);
      await this.jobRepository.markFailed(jobId, message);
    }
  }

  /**
   * Fetch the PR-head code, keep the changed functions, analyse them, and persist
   * a self-contained PrAnalysis. Public so the full flow is testable with an
   * injected fetcher; `submit` wraps it in the job/dedup machinery.
   */
  async analyze(
    repo: HydratedDocument<IRepo>,
    meta: PullMeta,
    onStage?: StageReporter
  ): Promise<HydratedDocument<IPrAnalysis>> {
    await onStage?.('fetch');
    const files = await this.githubPr.getChangedFiles(repo.owner, repo.name, meta.prNumber);
    const rangesByFile = changedSourceRanges(files);

    let changedFns: ExtractedFunction[] = [];
    if (rangesByFile.size > 0) {
      await onStage?.('parse');
      changedFns = await this.extractChangedFunctions(repo, meta, rangesByFile);
    }

    const findings =
      changedFns.length > 0 ? await this.analyzeChangedFunctions(repo, changedFns, onStage) : [];

    return this.prAnalysisRepository.create({
      owner: repo.owner,
      name: repo.name,
      prNumber: meta.prNumber,
      headSha: meta.headSha,
      baseSha: meta.baseSha,
      prUrl: meta.prUrl,
      changedFunctions: changedFns.length,
      findings,
    });
  }

  /** Download the PR-head versions of the changed source files and lift out the
   * functions whose lines overlap the added ranges. */
  private async extractChangedFunctions(
    repo: HydratedDocument<IRepo>,
    meta: PullMeta,
    rangesByFile: Map<string, [number, number][]>
  ): Promise<ExtractedFunction[]> {
    const wanted = new Set(rangesByFile.keys());
    // ref = head SHA so we read exactly the code the PR proposes.
    const fetched = await this.fetchRepoFiles({
      owner: repo.owner,
      name: repo.name,
      branch: meta.headSha,
      accept: (path) => wanted.has(path),
    });

    const inputs: ChangedFileInput[] = [];
    for (const [file, ranges] of rangesByFile) {
      const contents = fetched.files.get(file);
      if (contents === undefined) {
        logger.warn(`PR head is missing ${file} at ${meta.headSha.slice(0, 7)} — skipping`);
        continue;
      }
      inputs.push({ file, contents, ranges });
    }
    return selectChangedFunctions(inputs);
  }

  /**
   * The heart: match each changed function against the repo's cached index, and
   * for a confirmed match run the execution probe when both sides are pure.
   *
   * Public and pure over its arguments (no GitHub, no job), so the executed and
   * suspected paths are unit-testable against a synthetic index.
   */
  async analyzeChangedFunctions(
    repo: HydratedDocument<IRepo>,
    changedFns: ExtractedFunction[],
    onStage?: StageReporter
  ): Promise<PrFinding[]> {
    const repoId = repo._id.toString();
    const existing = (await this.functionRepository.findByRepo(repoId)).filter(
      (fn) => fn.fingerprint && fn.embedding && fn.embedding.length > 0
    );

    // Nothing to compare against — every changed function is novel by definition.
    if (existing.length === 0) return changedFns.map((fn) => novelFinding(fn, 0));

    // Cosine across two embed recipes is meaningless. The repo's index is written
    // uniformly by the pipeline, so a mismatch means the whole index is stale —
    // rebuilding it is the pipeline's job, so we refuse loudly (same rule Guard
    // enforces) rather than return a garbage similarity.
    if (existing.some((fn) => fn.embedVersion !== EMBED_VERSION)) {
      throw new ConflictError(
        `${repo.owner}/${repo.name} was indexed under a different embedding recipe than the ` +
          `current one (${EMBED_VERSION}) — re-run the pipeline to rebuild its index before checking a PR.`
      );
    }

    // Reuse derivations by body content. A fingerprint is recipe-independent so
    // it is always reusable; an embedding is reusable ONLY under the current
    // recipe (respecting the T1a fix), else it is recomputed for this small set.
    const cached = await this.functionRepository.findCachedDerivations(
      changedFns.map((fn) => fn.bodyHash)
    );
    const cachedFingerprints = new Map(cached.map((row) => [row.bodyHash, row.fingerprint]));
    const cachedEmbeddings = new Map(
      cached
        .filter((row) => row.embedVersion === EMBED_VERSION)
        .map((row) => [row.bodyHash, row.embedding])
    );

    await onStage?.('fingerprint');
    const { byHash: fingerprints } = await this.fingerprintService.fingerprintAll(
      changedFns,
      cachedFingerprints
    );
    await onStage?.('embed');
    const { byHash: embeddings } = await this.embeddingService.embedAll(fingerprints, cachedEmbeddings);

    const index = existing.map(toClusterable);
    const usedByIndex = await this.buildUsedByIndex(repoId, existing);

    await onStage?.('cluster');
    await onStage?.('adjudicate');
    await onStage?.('probe');

    const findings: PrFinding[] = [];
    for (const fn of changedFns) {
      const fingerprint = fingerprints.get(fn.bodyHash);
      const embedding = embeddings.get(fn.bodyHash);
      if (!fingerprint || !embedding) {
        logger.warn(`PR: could not fingerprint ${fn.name} — treating as novel`);
        findings.push(novelFinding(fn, 0));
        continue;
      }

      const prClusterable: ClusterableFunction = {
        id: 'pr',
        embedding,
        arity: fn.params.length,
        isPure: fn.isPure,
        inputs: fingerprint.inputs,
        outputs: fingerprint.outputs,
        file: fn.file,
      };

      const best = findBestMatch(prClusterable, index);
      // No compatible neighbour, or too weak to spend a flagship call on → novel.
      if (!best || best.similarity < PR_SEARCH_FLOOR) {
        findings.push(novelFinding(fn, best?.similarity ?? 0));
        continue;
      }

      const existingDoc = existing.find((doc) => doc._id.toString() === best.id);
      if (!existingDoc) {
        findings.push(novelFinding(fn, best.similarity));
        continue;
      }

      // §3.5: build a candidate cluster of [PR fn + matched impl] and adjudicate it.
      const candidateCluster = findCandidateClusters([prClusterable, toClusterable(existingDoc)]);
      if (candidateCluster.length === 0) {
        findings.push(novelFinding(fn, best.similarity));
        continue;
      }

      const adjudicated = await this.adjudicateService.adjudicate([
        { id: 'pr', body: fn.body, domain: fingerprint.domain },
        { id: 'baseline', body: existingDoc.body, domain: existingDoc.fingerprint?.domain ?? 'unknown' },
      ]);
      // The flagship says these are NOT the same job — believe it. Novel.
      if (!adjudicated) {
        findings.push(novelFinding(fn, best.similarity));
        continue;
      }

      const usedBy = usedByIndex.get(best.id) ?? [moduleOf(existingDoc.file)];
      const bothPure = fn.isPure && existingDoc.isPure;

      // THE DIFFERENTIATOR: both pure → execute in the sandbox and prove it.
      let divergence: PrFinding['divergence'] = null;
      let proof: PrFinding['proof'] = 'suspected';
      if (bothPure) {
        const table = await this.probeService.probe(
          [
            { id: 'pr', body: fn.body, isPure: fn.isPure, language: fn.language ?? 'ts', preamble: fn.preamble },
            {
              id: 'baseline',
              body: existingDoc.body,
              isPure: existingDoc.isPure,
              language: (existingDoc.language as 'ts' | 'python' | undefined) ?? 'ts',
              preamble: existingDoc.preamble,
            },
          ],
          adjudicated.probeInputs
        );
        if (table?.executed) {
          divergence = table;
          proof = 'executed';
        }
      }

      findings.push({
        newFunction: { name: fn.name, file: fn.file, startLine: fn.startLine, endLine: fn.endLine },
        match: {
          name: existingDoc.name,
          file: existingDoc.file,
          startLine: existingDoc.startLine,
          endLine: existingDoc.endLine,
        },
        verdict: adjudicated.confidence >= CONFIDENCE_THRESHOLD ? 'duplicate' : 'near-duplicate',
        similarity: round(best.similarity),
        confidence: round(adjudicated.confidence),
        usedBy,
        divergence,
        proof,
      });
    }

    return findings;
  }

  /** Fetch a finished analysis for GET /api/v1/pr/:id. */
  async getAnalysis(id: string): Promise<PrAnalysis> {
    const doc = await this.prAnalysisRepository.findByIdOrFail(id);
    return toPrAnalysis(doc);
  }

  /**
   * Which modules already contain a matched function's behaviour — the modules
   * of its cluster's members (Guard's usedBy, reused verbatim in spirit).
   */
  private async buildUsedByIndex(
    repoId: string,
    functions: HydratedDocument<IFunction>[]
  ): Promise<Map<string, string[]>> {
    const clusters = await this.clusterRepository.findByRepo(repoId);
    const moduleById = new Map(functions.map((fn) => [fn._id.toString(), moduleOf(fn.file)]));
    const usedBy = new Map<string, string[]>();
    for (const cluster of clusters) {
      const ids = cluster.functionIds.map((id) => id.toString());
      const modules = [...new Set(ids.map((id) => moduleById.get(id)).filter(Boolean))] as string[];
      for (const id of ids) usedBy.set(id, modules);
    }
    return usedBy;
  }
}

/** Serialise a stored analysis to the pinned PrAnalysis API shape (§3.4). */
export const toPrAnalysis = (doc: HydratedDocument<IPrAnalysis>): PrAnalysis => ({
  id: doc._id.toString(),
  owner: doc.owner,
  name: doc.name,
  prNumber: doc.prNumber,
  headSha: doc.headSha,
  baseSha: doc.baseSha,
  prUrl: doc.prUrl,
  changedFunctions: doc.changedFunctions,
  findings: doc.findings,
  createdAt: doc.createdAt.toISOString(),
});

export default PrService;
