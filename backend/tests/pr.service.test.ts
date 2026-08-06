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

  it('dedups by headSha — returns the stored analysis without a job or GitHub file fetch', async () => {
    const getChangedFiles = vi.fn();
    const create = vi.fn();
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
    });

    const result = await service.submit({ owner: 'o', name: 'r' });

    expect(result).toEqual({ jobId: null, prAnalysisId: 'pa-99' });
    expect(create).not.toHaveBeenCalled(); // no job spun up on a dedup hit
    expect(getChangedFiles).not.toHaveBeenCalled(); // and no re-spend
  });

  it('returns a clear 409 when the base repo is not indexed yet', async () => {
    const resolvePull = vi.fn();
    const service = new PrService({
      repoRepository: { findLatest: vi.fn().mockResolvedValue(null) } as never,
      githubPr: { resolvePull, getChangedFiles: vi.fn() } as never,
    });

    await expect(service.submit({ owner: 'o', name: 'r' })).rejects.toThrow(/not indexed/);
    expect(resolvePull).not.toHaveBeenCalled(); // fail fast before any GitHub call
  });
});
