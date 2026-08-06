import FingerprintService from './fingerprint.service.js';
import EmbeddingService, { EMBED_VERSION } from './embedding.service.js';
import AdjudicateService from './adjudicate.service.js';
import ProbeService from './probe.service.js';
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
  }

  /**
   * Submit a PR for analysis.
   *
   * Runs synchronously (a PR adds a handful of functions, so this is fast like
   * Guard's /check) but ALSO drives a Job through the same stages the frontend
   * poll renders, so `GET /jobs/:id` works unchanged. A dedup hit (same headSha
   * already analysed) returns the stored analysis for ₹0 and creates no job.
   */
  async submit(input: PrAnalyzeInput): Promise<PrSubmitResult> {
    // Stage A: the base repo must already be indexed. (Stage B adds index-if-absent.)
    const repo = await this.repoRepository.findLatest(input.owner, input.name);
    if (!repo) {
      throw new ConflictError(
        `${input.owner}/${input.name} is not indexed yet — analyze the repo first, then re-run the PR check.`
      );
    }

    const meta = await this.githubPr.resolvePull(input.owner, input.name, input.prNumber);

    // Dedup on head commit: the same code proposed again is the same answer.
    const cached = await this.prAnalysisRepository.findByHeadSha(meta.headSha);
    if (cached) {
      logger.info(`PR dedup hit for ${input.owner}/${input.name} @ ${meta.headSha.slice(0, 7)}`);
      return { jobId: null, prAnalysisId: cached._id.toString() };
    }

    const job = await this.jobRepository.create({
      owner: input.owner,
      name: input.name,
      ref: meta.headRef,
      status: 'running',
      stage: 'fetch',
      pr: {
        prNumber: meta.prNumber,
        headSha: meta.headSha,
        baseSha: meta.baseSha,
        headRef: meta.headRef,
        changedFunctions: 0,
        indexedOnDemand: false,
      },
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
            { id: 'pr', body: fn.body, isPure: fn.isPure, preamble: fn.preamble },
            {
              id: 'baseline',
              body: existingDoc.body,
              isPure: existingDoc.isPure,
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
