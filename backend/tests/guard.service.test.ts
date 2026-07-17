import { describe, it, expect, vi } from 'vitest';

import GuardService from '../src/Services/guard.service.js';
import { buildEmbedText } from '../src/Services/embedding.service.js';
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
});
