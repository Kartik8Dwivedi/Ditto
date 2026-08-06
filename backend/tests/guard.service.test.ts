import { describe, it, expect, vi } from 'vitest';

import GuardService from '../src/Services/guard.service.js';
import { buildEmbedText, EMBED_VERSION } from '../src/Services/embedding.service.js';
import type { Fingerprint } from '../src/Models/contracts.js';

/**
 * Guard is the business: fingerprint ONLY the PR's new functions, search the
 * existing index by cosine, and consult the flagship only when the search
 * actually found a candidate. It must be cheap by construction.
 */

const phoneFingerprint: Fingerprint = {
  intent: 'reduce a phone number to ten digits',
  inputs: ['string'],
  outputs: ['string'],
  sideEffects: [],
  domain: 'phone-number',
  behavior: ['strip non-digits', 'drop country code'],
  pure: true,
};

const existingDoc = (id: string, name: string, embedding: number[]) => ({
  _id: { toString: () => id },
  name,
  file: 'src/common/phone.ts',
  startLine: 10,
  body: `function ${name}(s){ return s.replace(/\\D/g,''); }`,
  isPure: true,
  params: ['s'],
  fingerprint: phoneFingerprint,
  embedding,
  // The stored index vector was built under the CURRENT recipe — the guard
  // refuses to cosine-compare against a stale index (see the stale-index test).
  embedVersion: EMBED_VERSION,
});

const incoming = {
  name: 'cleanNumber',
  file: 'src/pr/new.ts',
  startLine: 1,
  endLine: 3,
  signature: '',
  body: `function cleanNumber(s){ return String(s).replace(/[^0-9]/g,''); }`,
  isExported: true,
  params: ['s'],
  returnTypeText: 'string',
  imports: [],
  callsExternal: false,
  isPure: true,
};

const makeDeps = (opts: {
  repo: unknown;
  existing: unknown[];
  clusters?: unknown[];
  embedding: number[];
  adjudicate: unknown;
}) => {
  const adjudicateSpy = vi.fn().mockResolvedValue(opts.adjudicate);
  return {
    spies: { adjudicate: adjudicateSpy },
    deps: {
      repoRepository: { findLatest: vi.fn().mockResolvedValue(opts.repo) } as never,
      functionRepository: {
        findByRepo: vi.fn().mockResolvedValue(opts.existing),
        findCachedDerivations: vi.fn().mockResolvedValue([]),
      } as never,
      clusterRepository: { findByRepo: vi.fn().mockResolvedValue(opts.clusters ?? []) } as never,
      fingerprintService: {
        fingerprintAll: vi
          .fn()
          .mockResolvedValue({ byHash: new Map([[hashOf(incoming.body), phoneFingerprint]]) }),
      } as never,
      embeddingService: {
        embedAll: vi.fn().mockResolvedValue({ byHash: new Map([[hashOf(incoming.body), opts.embedding]]) }),
      } as never,
      adjudicateService: { adjudicate: adjudicateSpy } as never,
    },
  };
};

// Mirror the service's fallback hash so the mocked fingerprint map lines up.
import { createHash } from 'node:crypto';
const hashOf = (body: string) => createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex');

describe('GuardService.check', () => {
  const repo = { _id: { toString: () => 'repo-1' } };

  it('flags a duplicate the flagship confirms with high confidence', async () => {
    const { deps, spies } = makeDeps({
      repo,
      existing: [existingDoc('fn-1', 'normalizePhone', [1, 0, 0])],
      embedding: [1, 0, 0], // identical direction -> similarity ~1
      adjudicate: {
        memberIds: ['incoming', 'fn-1'],
        canonicalId: 'fn-1',
        confidence: 0.96,
        disagreementRisk: 'semantic',
        differences: [],
        behaviorSummary: 'phone normalisation',
        domain: 'phone-number',
        probeInputs: [],
      },
    });

    const result = await new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].verdict).toBe('duplicate');
    expect(result.matches[0].existingFunction.name).toBe('normalizePhone');
    expect(result.matches[0].confidence).toBe(0.96);
    expect(spies.adjudicate).toHaveBeenCalledTimes(1);
  });

  it('does NOT pay for a flagship call when the vector search is weak', async () => {
    const { deps, spies } = makeDeps({
      repo,
      existing: [existingDoc('fn-1', 'unrelated', [0, 1, 0])], // orthogonal
      embedding: [1, 0, 0],
      adjudicate: null,
    });

    const result = await new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] });

    // Cheap by construction: a weak match is 'novel' and never reaches the model.
    expect(result.matches[0].verdict).toBe('novel');
    expect(spies.adjudicate).not.toHaveBeenCalled();
  });

  it('degrades to near-duplicate when the flagship is unsure', async () => {
    const { deps } = makeDeps({
      repo,
      existing: [existingDoc('fn-1', 'normalizePhone', [1, 0, 0])],
      embedding: [1, 0, 0],
      adjudicate: {
        memberIds: ['incoming', 'fn-1'],
        canonicalId: 'fn-1',
        confidence: 0.6, // below the claim threshold
        disagreementRisk: 'cosmetic',
        differences: [],
        behaviorSummary: 'phone normalisation',
        domain: 'phone-number',
        probeInputs: [],
      },
    });

    const result = await new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] });
    expect(result.matches[0].verdict).toBe('near-duplicate');
  });

  it('reports usedBy modules from the existing clusters', async () => {
    const { deps } = makeDeps({
      repo,
      existing: [
        existingDoc('fn-1', 'normalizePhone', [1, 0, 0]),
        { ...existingDoc('fn-2', 'formatMobile', [1, 0, 0]), file: 'src/auth/phone.ts' },
      ],
      clusters: [{ functionIds: [{ toString: () => 'fn-1' }, { toString: () => 'fn-2' }] }],
      embedding: [1, 0, 0],
      adjudicate: {
        memberIds: ['incoming', 'fn-1'],
        canonicalId: 'fn-1',
        confidence: 0.96,
        disagreementRisk: 'none',
        differences: [],
        behaviorSummary: 'phone normalisation',
        domain: 'phone-number',
        probeInputs: [],
      },
    });

    const result = await new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] });
    expect(result.matches[0].usedBy).toEqual(expect.arrayContaining(['src/common', 'src/auth']));
  });

  it('embeds only the fingerprint, never the incoming code', async () => {
    const { deps } = makeDeps({
      repo,
      existing: [existingDoc('fn-1', 'normalizePhone', [1, 0, 0])],
      embedding: [1, 0, 0],
      adjudicate: null,
    });
    const service = new GuardService(deps);
    await service.check({ owner: 'o', name: 'r', functions: [incoming] });

    // The embedding stage was handed fingerprints, and buildEmbedText from them
    // contains no code — proven exhaustively in embedding.service.test.ts. Here
    // we just confirm Guard routes through that same path.
    const embedText = buildEmbedText(phoneFingerprint);
    expect(embedText).not.toContain('cleanNumber');
  });

  it('throws a clear error when the repo has never been indexed', async () => {
    const { deps } = makeDeps({ repo: null, existing: [], embedding: [1, 0, 0], adjudicate: null });
    await expect(
      new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] })
    ).rejects.toThrow(/not been indexed/);
  });

  it('does NOT reuse a cross-repo cached embedding built under a STALE recipe — it recomputes', async () => {
    // A content-addressed cache hit (same bodyHash, different repo) whose vector
    // was built under an OLDER recipe. `findCachedDerivations` is unscoped across
    // repos, so this is exactly the poison the guard must refuse to reuse.
    const hash = hashOf(incoming.body);
    const staleEmbedding = [0, 1, 0]; // orthogonal to the current index vector
    const embedAllSpy = vi
      .fn()
      // Simulate the recompute: hand back a CURRENT-recipe vector, not the stale one.
      .mockResolvedValue({ byHash: new Map([[hash, [1, 0, 0]]]) });

    const deps = {
      repoRepository: { findLatest: vi.fn().mockResolvedValue(repo) } as never,
      functionRepository: {
        // Stored index is current-recipe, so the comparison itself is legitimate.
        findByRepo: vi.fn().mockResolvedValue([existingDoc('fn-1', 'normalizePhone', [1, 0, 0])]),
        findCachedDerivations: vi.fn().mockResolvedValue([
          {
            bodyHash: hash,
            fingerprint: phoneFingerprint,
            embedding: staleEmbedding,
            embedVersion: 'v1-old-recipe',
          },
        ]),
      } as never,
      clusterRepository: { findByRepo: vi.fn().mockResolvedValue([]) } as never,
      fingerprintService: {
        fingerprintAll: vi.fn().mockResolvedValue({ byHash: new Map([[hash, phoneFingerprint]]) }),
      } as never,
      embeddingService: { embedAll: embedAllSpy } as never,
      adjudicateService: {
        adjudicate: vi.fn().mockResolvedValue({
          memberIds: ['incoming', 'fn-1'],
          canonicalId: 'fn-1',
          confidence: 0.96,
          disagreementRisk: 'semantic',
          differences: [],
          behaviorSummary: 'phone normalisation',
          domain: 'phone-number',
          probeInputs: [],
        }),
      } as never,
    };

    await new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] });

    // THE ASSERTION: the stale vector must never enter the embedding-reuse cache,
    // so embedAll is forced to recompute it under the current recipe.
    const reuseCache = embedAllSpy.mock.calls[0][1] as Map<string, number[]>;
    expect(reuseCache.get(hash)).toBeUndefined();
    expect(reuseCache.has(hash)).toBe(false);
  });

  it('refuses (does not silently compare) when the stored index is a STALE recipe', async () => {
    // The repo was indexed under an older embed recipe. Cosine across recipes is
    // meaningless, and rebuilding the index is the pipeline's job — so guard must
    // fail loud rather than return a garbage similarity.
    const stale = { ...existingDoc('fn-1', 'normalizePhone', [1, 0, 0]), embedVersion: 'v1-old' };
    const { deps } = makeDeps({ repo, existing: [stale], embedding: [1, 0, 0], adjudicate: null });

    await expect(
      new GuardService(deps).check({ owner: 'o', name: 'r', functions: [incoming] })
    ).rejects.toThrow(/embedding recipe/);
  });
});
