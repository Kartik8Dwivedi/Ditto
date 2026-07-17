import { createHash } from 'node:crypto';

import FingerprintService from './fingerprint.service.js';
import EmbeddingService from './embedding.service.js';
import AdjudicateService from './adjudicate.service.js';
import { cosineSimilarity, isCompatible, type ClusterableFunction } from './cluster.service.js';
import { CONFIDENCE_THRESHOLD, moduleOf } from './stats.service.js';
import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import logger from '../Config/logger.js';
import { NotFoundError } from '../Utils/errors/AppError.js';
import type { ExtractedFunction, GuardResult, IFunction } from '../Models/index.js';
import type { HydratedDocument } from 'mongoose';

/**
 * DITTO GUARD — the map finds the debt, the check stops you adding to it.
 *
 * A PR opens. We fingerprint ONLY the functions it adds — one to five cheap
 * calls — embed them, and search an index we already paid for. The flagship is
 * consulted only when the search has actually found something. Most PRs are
 * novel and cost a fraction of a rupee.
 *
 * That is the slide: the thing that makes money is the cheapest thing we run.
 */

/**
 * Below this similarity we do not pay a flagship model to tell us what the
 * vectors already said. The result is 'novel' and the PR costs ~₹0.10.
 */
export const GUARD_SEARCH_FLOOR = 0.8;

/** What the caller sends us: the functions a PR adds. */
export interface GuardCheckInput {
  owner: string;
  name: string;
  /** `bodyHash` and `loc` are derived here when the caller omits them. */
  functions: Array<Omit<ExtractedFunction, 'bodyHash' | 'loc'> & { bodyHash?: string; loc?: number }>;
}

interface GuardServiceDeps {
  repoRepository?: RepoRepository;
  functionRepository?: FunctionRepository;
  clusterRepository?: ClusterRepository;
  fingerprintService?: FingerprintService;
  embeddingService?: EmbeddingService;
  adjudicateService?: AdjudicateService;
}

/**
 * Fallback body hash, used only when a caller omits one.
 *
 * The extractor is the authority on this value. If our normalisation ever
 * disagrees with its, the cost is a cache miss — one extra cheap call — never a
 * wrong answer.
 */
const hashBody = (body: string): string =>
  createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex');

const normaliseInput = (fn: GuardCheckInput['functions'][number]): ExtractedFunction => ({
  ...fn,
  bodyHash: fn.bodyHash ?? hashBody(fn.body),
  loc: fn.loc ?? fn.body.split('\n').length,
});

class GuardService {
  private readonly repoRepository: RepoRepository;
  private readonly functionRepository: FunctionRepository;
  private readonly clusterRepository: ClusterRepository;
  private readonly fingerprintService: FingerprintService;
  private readonly embeddingService: EmbeddingService;
  private readonly adjudicateService: AdjudicateService;

  constructor({
    repoRepository = new RepoRepository(),
    functionRepository = new FunctionRepository(),
    clusterRepository = new ClusterRepository(),
    fingerprintService = new FingerprintService(),
    embeddingService = new EmbeddingService(),
    adjudicateService = new AdjudicateService(),
  }: GuardServiceDeps = {}) {
    this.repoRepository = repoRepository;
    this.functionRepository = functionRepository;
    this.clusterRepository = clusterRepository;
    this.fingerprintService = fingerprintService;
    this.embeddingService = embeddingService;
    this.adjudicateService = adjudicateService;
  }

  async check(input: GuardCheckInput): Promise<GuardResult> {
    const repo = await this.repoRepository.findLatest(input.owner, input.name);
    if (!repo) {
      throw new NotFoundError(
        `${input.owner}/${input.name} has not been indexed yet — run the pipeline against it first`
      );
    }

    const incoming = input.functions.map(normaliseInput);
    if (incoming.length === 0) return { matches: [] };

    const repoId = repo._id.toString();
    const existing = (await this.functionRepository.findByRepo(repoId)).filter(
      (fn) => fn.fingerprint && fn.embedding && fn.embedding.length > 0
    );
    if (existing.length === 0) return { matches: [] };

    // Only the new functions are fingerprinted, and a body we have already seen
    // (a reverted change, a rebase, a re-run of the check) costs nothing.
    const cached = await this.functionRepository.findCachedDerivations(
      incoming.map((fn) => fn.bodyHash)
    );
    const cachedFingerprints = new Map(cached.map((row) => [row.bodyHash, row.fingerprint]));
    const cachedEmbeddings = new Map(cached.map((row) => [row.bodyHash, row.embedding]));

    const { byHash: fingerprints } = await this.fingerprintService.fingerprintAll(
      incoming,
      cachedFingerprints
    );
    const { byHash: embeddings } = await this.embeddingService.embedAll(
      fingerprints,
      cachedEmbeddings
    );

    const index = existing.map(toClusterable);
    const usedByCache = await this.buildUsedByIndex(repoId, existing);

    const matches: GuardResult['matches'] = [];
    for (const fn of incoming) {
      const fingerprint = fingerprints.get(fn.bodyHash);
      const embedding = embeddings.get(fn.bodyHash);
      if (!fingerprint || !embedding) {
        logger.warn(`guard could not fingerprint ${fn.name} — skipping`);
        continue;
      }

      const probe: ClusterableFunction = {
        id: 'incoming',
        embedding,
        arity: fn.params.length,
        isPure: fn.isPure,
        inputs: fingerprint.inputs,
        outputs: fingerprint.outputs,
      };

      const best = findBestMatch(probe, index);
      if (!best) continue;

      const existingDoc = existing.find((doc) => doc._id.toString() === best.id);
      if (!existingDoc) continue;

      const match = {
        newFunction: fn.name,
        existingFunction: {
          id: best.id,
          name: existingDoc.name,
          file: existingDoc.file,
          startLine: existingDoc.startLine,
        },
        similarity: round(best.similarity),
        usedBy: usedByCache.get(best.id) ?? [moduleOf(existingDoc.file)],
      };

      // Cost gate: a weak vector match is not worth a flagship call.
      if (best.similarity < GUARD_SEARCH_FLOOR) {
        matches.push({ ...match, confidence: 0, verdict: 'novel' });
        continue;
      }

      const verdict = await this.adjudicatePair(fn, existingDoc);
      matches.push({ ...match, ...verdict });
    }

    return { matches };
  }

  /** One flagship call, on one pair, only when the search found a real candidate. */
  private async adjudicatePair(
    incoming: ExtractedFunction,
    existing: HydratedDocument<IFunction>
  ): Promise<{ confidence: number; verdict: GuardResult['matches'][number]['verdict'] }> {
    try {
      const adjudicated = await this.adjudicateService.adjudicate([
        { id: 'incoming', body: incoming.body, domain: 'unknown' },
        { id: existing._id.toString(), body: existing.body, domain: existing.fingerprint?.domain ?? 'unknown' },
      ]);

      // The adjudicator says they are different things. Believe it — that
      // refusal is the whole reason this stage exists.
      if (!adjudicated) return { confidence: 0, verdict: 'novel' };

      return {
        confidence: round(adjudicated.confidence),
        verdict: adjudicated.confidence >= CONFIDENCE_THRESHOLD ? 'duplicate' : 'near-duplicate',
      };
    } catch (err) {
      // A failed check must not block a PR on a claim we could not make.
      logger.warn(
        `guard adjudication failed for ${incoming.name} — reporting as near-duplicate:`,
        err instanceof Error ? err.message : err
      );
      return { confidence: 0, verdict: 'near-duplicate' };
    }
  }

  /**
   * Which modules already contain this behaviour.
   *
   * NOT a call graph — we do not have one. For a function that belongs to a
   * cluster this is the set of modules its equivalent implementations live in,
   * which is the useful thing to tell an author anyway: "this already exists in
   * auth, checkout and billing."
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

/**
 * Nearest compatible neighbour by cosine. A linear scan: at repo scale this is
 * a few thousand dot products and finishes long before the network round-trip
 * that carried the request in.
 */
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

export default GuardService;
