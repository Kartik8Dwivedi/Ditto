import { describe, it, expect, vi } from 'vitest';

import PrService from '../src/Services/pr.service.js';
import ProbeService from '../src/Services/probe.service.js';
import { EMBED_VERSION } from '../src/Services/embedding.service.js';
import type { ExtractedFunction, Fingerprint } from '../src/Models/contracts.js';

/**
 * The PR agent's contract (§3.4/§3.5): match a changed function against the
 * repo's cached index, and — the differentiator — when both the PR function and
 * its match are PURE, EXECUTE them in the sandbox and set proof:'executed'. An
 * impure match is proof:'suspected', a model opinion never dressed as proof.
 *
 * These tests inject mocked repositories + LLM stages (like guard.service.test)
 * but use a REAL ProbeService, so the executed divergence is genuinely run — no
 * live GitHub, no OpenAI, no Mongo.
 */

const stringNumberFingerprint: Fingerprint = {
  intent: 'shorten a string to a maximum length',
  inputs: ['string', 'number'],
  outputs: ['string'],
  sideEffects: [],
  domain: 'string',
  behavior: ['compare length', 'slice'],
  pure: true,
};

/** A repo-index document for a pure two-arg truncate, under the CURRENT recipe. */
const truncateDoc = (opts: { isPure: boolean }) => ({
  _id: { toString: () => 'fn-1' },
  name: 'truncate',
  file: 'src/util/str.ts',
  startLine: 10,
  endLine: 12,
  body: `function truncate(s, n){ return s.length > n ? s.slice(0, n) + '...' : s; }`,
  isPure: opts.isPure,
  params: ['s', 'n'],
  fingerprint: stringNumberFingerprint,
  embedding: [1, 0, 0],
  embedVersion: EMBED_VERSION,
});

/** The PR's changed function — a reinvented, subtly different truncate. */
const prFunction = (opts: { isPure: boolean }): ExtractedFunction => ({
  name: 'shorten',
  file: 'src/pr/new.ts',
  startLine: 1,
  endLine: 3,
  signature: '',
  body: `function shorten(str, max){ if (str.length <= max) return str; return str.slice(0, max - 3) + '...'; }`,
  bodyHash: 'pr-body-hash',
  loc: 3,
  isExported: true,
  params: ['str', 'max'],
  returnTypeText: 'string',
  imports: [],
  callsExternal: false,
  isPure: opts.isPure,
  language: 'ts'
});

const repo = { _id: { toString: () => 'repo-1' }, owner: 'o', name: 'r' };

const makeService = (opts: {
  existing: unknown[];
  adjudicate: unknown;
  clusters?: unknown[];
}) =>
  new PrService({
    functionRepository: {
      findByRepo: vi.fn().mockResolvedValue(opts.existing),
      findCachedDerivations: vi.fn().mockResolvedValue([]),
    } as never,
    clusterRepository: { findByRepo: vi.fn().mockResolvedValue(opts.clusters ?? []) } as never,
    fingerprintService: {
      fingerprintAll: vi
        .fn()
        .mockResolvedValue({ byHash: new Map([['pr-body-hash', stringNumberFingerprint]]) }),
    } as never,
    embeddingService: {
      embedAll: vi.fn().mockResolvedValue({ byHash: new Map([['pr-body-hash', [1, 0, 0]]]) }),
    } as never,
    adjudicateService: { adjudicate: vi.fn().mockResolvedValue(opts.adjudicate) } as never,
    // The real prober — the executed divergence is genuinely run.
    probeService: new ProbeService(),
  });

const MATCHED_ADJUDICATION = {
  memberIds: ['pr', 'baseline'],
  canonicalId: 'baseline',
  behaviorSummary: 'truncate a string to a length',
  domain: 'string',
  differences: ['one reserves room for the ellipsis, the other does not'],
  disagreementRisk: 'semantic',
  confidence: 0.95,
  // ["hello world",5] diverges (he... vs hello...); ["hi",5] agrees (hi).
  probeInputs: ['["hello world",5]', '["hi",5]'],
};

describe('PrService.analyzeChangedFunctions', () => {
  it('proof:executed — runs the sandbox on a pure reinvented pair and proves divergence', async () => {
    const service = makeService({
      existing: [truncateDoc({ isPure: true })],
      adjudicate: MATCHED_ADJUDICATION,
    });

    const findings = await service.analyzeChangedFunctions(repo as never, [prFunction({ isPure: true })]);

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.proof).toBe('executed');
    expect(finding.verdict).toBe('duplicate'); // confidence 0.95 >= 0.75
    expect(finding.newFunction.name).toBe('shorten');
    expect(finding.match?.name).toBe('truncate');
    expect(finding.divergence).not.toBeNull();
    expect(finding.divergence!.executed).toBe(true);
    // The sandbox actually ran and found a real disagreement.
    expect(finding.divergence!.rows.some((row) => row.diverged)).toBe(true);
  });

  it('proof:suspected — a confirmed but IMPURE match is not executed, divergence null', async () => {
    // Both impure: the compatibility gate only matches like-purity, so an impure
    // match means both sides impure → executable-proof is off the table.
    const service = makeService({
      existing: [truncateDoc({ isPure: false })],
      adjudicate: MATCHED_ADJUDICATION,
    });

    const findings = await service.analyzeChangedFunctions(repo as never, [prFunction({ isPure: false })]);

    expect(findings).toHaveLength(1);
    expect(findings[0].proof).toBe('suspected');
    expect(findings[0].divergence).toBeNull();
    expect(findings[0].match?.name).toBe('truncate');
    expect(['duplicate', 'near-duplicate']).toContain(findings[0].verdict);
  });

  it('proof:none — a function with no index match is novel', async () => {
    const service = makeService({
      // Orthogonal embedding → cosine 0, below the search floor.
      existing: [{ ...truncateDoc({ isPure: true }), embedding: [0, 1, 0] }],
      adjudicate: null,
    });

    const findings = await service.analyzeChangedFunctions(repo as never, [prFunction({ isPure: true })]);

    expect(findings).toHaveLength(1);
    expect(findings[0].verdict).toBe('novel');
    expect(findings[0].proof).toBe('none');
    expect(findings[0].match).toBeNull();
    expect(findings[0].divergence).toBeNull();
  });

  it('refuses a stale-recipe index rather than compare across embed recipes', async () => {
    const service = makeService({
      existing: [{ ...truncateDoc({ isPure: true }), embedVersion: 'v1-old-recipe' }],
      adjudicate: MATCHED_ADJUDICATION,
    });

    await expect(
      service.analyzeChangedFunctions(repo as never, [prFunction({ isPure: true })])
    ).rejects.toThrow(/embedding recipe/);
  });
});

describe('PrService.submit', () => {
  const meta = {
    prNumber: 7,
    headSha: 'head-sha-abc',
    baseSha: 'base-sha-def',
    headRef: 'feature/x',
    prUrl: 'https://github.com/o/r/pull/7',
  };

  it('CACHE: dedups by headSha and short-circuits BEFORE quota, GitHub files, and jobs', async () => {
    const getChangedFiles = vi.fn();
    const create = vi.fn();
    const consume = vi.fn();
    const service = new PrService({
      repoRepository: { findLatest: vi.fn().mockResolvedValue(repo) } as never,
      githubPr: {
        resolvePull: vi.fn().mockResolvedValue(meta),
        getChangedFiles,
      } as never,
      prAnalysisRepository: {
        findByHeadSha: vi.fn().mockResolvedValue({ _id: { toString: () => 'pa-99' } }),
      } as never,
      jobRepository: { create } as never,
      quotaService: { consume } as never,
    });

    const result = await service.submit({ owner: 'o', name: 'r' }, '1.2.3.4');

    expect(result).toEqual({ jobId: null, prAnalysisId: 'pa-99' });
    expect(create).not.toHaveBeenCalled(); // no job spun up on a cache hit
    expect(getChangedFiles).not.toHaveBeenCalled(); // and no re-spend on GitHub
    expect(consume).not.toHaveBeenCalled(); // ₹0 — the daily budget is untouched
  });

  it('INDEX-IF-ABSENT: an unindexed repo queues an index+PR job and charges the INDEX budget', async () => {
    const create = vi.fn().mockResolvedValue({ _id: { toString: () => 'job-77' } });
    const consume = vi.fn().mockResolvedValue(undefined);
    const isEnabled = vi.fn().mockReturnValue(true);
    const enqueueRun = vi.fn().mockResolvedValue(undefined);
    const service = new PrService({
      repoRepository: { findLatest: vi.fn().mockResolvedValue(null) } as never,
      githubPr: { resolvePull: vi.fn().mockResolvedValue(meta), getChangedFiles: vi.fn() } as never,
      prAnalysisRepository: { findByHeadSha: vi.fn().mockResolvedValue(null) } as never,
      jobRepository: { create } as never,
      quotaService: { consume } as never,
      tasksService: { isEnabled, enqueueRun } as never,
    });

    const result = await service.submit({ owner: 'o', name: 'r' }, '5.5.5.5');

    // Async: only a jobId comes back; the PR analysis is filled in on the poll.
    expect(result).toEqual({ jobId: 'job-77', prAnalysisId: null });
    // A full base-repo index is the expensive path → the tight INDEX budget.
    expect(consume).toHaveBeenCalledWith('5.5.5.5', 'index');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'o',
        name: 'r',
        status: 'queued',
        stage: 'queued',
        pr: expect.objectContaining({ indexedOnDemand: true, headSha: meta.headSha, prNumber: 7 }),
      })
    );
    expect(enqueueRun).toHaveBeenCalledWith('job-77');
  });

  it('QUOTA: blocks a PR check on an indexed repo when the PR budget is spent — no job, no re-spend', async () => {
    const getChangedFiles = vi.fn();
    const create = vi.fn();
    const consume = vi.fn().mockRejectedValue(new Error('Daily limit reached: PR checks'));
    const service = new PrService({
      repoRepository: { findLatest: vi.fn().mockResolvedValue(repo) } as never,
      githubPr: { resolvePull: vi.fn().mockResolvedValue(meta), getChangedFiles } as never,
      prAnalysisRepository: { findByHeadSha: vi.fn().mockResolvedValue(null) } as never,
      jobRepository: { create } as never,
      quotaService: { consume } as never,
    });

    await expect(service.submit({ owner: 'o', name: 'r' }, '5.5.5.5')).rejects.toThrow(/Daily limit/);
    expect(consume).toHaveBeenCalledWith('5.5.5.5', 'pr'); // an indexed repo → the loose PR bucket
    expect(create).not.toHaveBeenCalled();
    expect(getChangedFiles).not.toHaveBeenCalled();
  });
});

describe('PrService.runPrJob (index-if-absent worker)', () => {
  const prJobDoc = {
    _id: { toString: () => 'job-1' },
    owner: 'o',
    name: 'r',
    ref: null,
    pr: { prNumber: 7, headSha: 'head-sha-abc', baseSha: 'base-sha-def', headRef: 'feature/x' },
  };

  it('indexes the base repo (the ONE pipeline.run), then runs the PR analysis and marks the job done', async () => {
    const extract = vi.fn().mockResolvedValue({ functions: [{ name: 'f0' }], commit: 'c1' });
    const run = vi.fn().mockResolvedValue({ repoId: 'repo-xyz' });
    const markRunning = vi.fn().mockResolvedValue(undefined);
    const setStage = vi.fn().mockResolvedValue(undefined);
    const setPrChangedFunctions = vi.fn().mockResolvedValue(undefined);
    const markPrDone = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const repoDoc = { _id: { toString: () => 'repo-xyz' }, owner: 'o', name: 'r' };

    const service = new PrService({
      jobRepository: {
        findById: vi.fn().mockResolvedValue(prJobDoc),
        markRunning,
        setStage,
        setPrChangedFunctions,
        markPrDone,
        markFailed,
      } as never,
      repoRepository: { findById: vi.fn().mockResolvedValue(repoDoc) } as never,
      indexerService: { extract } as never,
      pipelineService: { run } as never,
    });

    // The PR analysis itself is exercised by the analyzeChangedFunctions tests
    // above; here we stub it to keep the focus on the index→check→done wiring.
    const analysis = { _id: { toString: () => 'pa-1' }, changedFunctions: 3, findings: [1, 2, 3] };
    const analyzeSpy = vi.spyOn(service, 'analyze').mockResolvedValue(analysis as never);

    await service.runPrJob('job-1');

    // The base repo was indexed — this is the ONLY place a PR flow calls pipeline.run.
    expect(run).toHaveBeenCalledTimes(1);
    expect(analyzeSpy).toHaveBeenCalled();
    expect(setPrChangedFunctions).toHaveBeenCalledWith('job-1', 3);
    expect(markPrDone).toHaveBeenCalledWith('job-1', analysis._id);
    expect(markFailed).not.toHaveBeenCalled();
  });
});
