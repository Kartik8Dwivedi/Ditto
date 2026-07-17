import { describe, it, expect } from 'vitest';

import {
  cosineSimilarity,
  findCandidateClusters,
  isCompatible,
  MAX_CLUSTER_SIZE,
  type ClusterableFunction,
} from '../src/Services/cluster.service.js';

/**
 * Clustering is the stage that makes the whole architecture affordable, and it
 * is pure arithmetic — so it is tested with synthetic vectors, no API, no DB.
 */

/** A unit vector at `angle` radians, padded out so it looks like an embedding. */
const vectorAt = (angle: number): number[] => [Math.cos(angle), Math.sin(angle), 0];

const fn = (overrides: Partial<ClusterableFunction> & { id: string }): ClusterableFunction => ({
  embedding: vectorAt(0),
  arity: 1,
  isPure: true,
  inputs: ['string'],
  outputs: ['string'],
  ...overrides,
});

describe('cosineSimilarity', () => {
  it('is 1 for identical direction and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });

  it('returns 0 rather than NaN for degenerate input', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe('isCompatible', () => {
  it('rejects a pure and an impure function outright', () => {
    expect(isCompatible(fn({ id: 'a' }), fn({ id: 'b', isPure: false }))).toBe(false);
  });

  it('rejects different arity buckets but not arity 3 versus 7', () => {
    expect(isCompatible(fn({ id: 'a', arity: 1 }), fn({ id: 'b', arity: 2 }))).toBe(false);
    expect(isCompatible(fn({ id: 'a', arity: 3 }), fn({ id: 'b', arity: 7 }))).toBe(true);
  });

  it('rejects incompatible output shapes', () => {
    expect(isCompatible(fn({ id: 'a' }), fn({ id: 'b', outputs: ['number'] }))).toBe(false);
  });

  it('treats nullable and cased types as the same claim', () => {
    expect(isCompatible(fn({ id: 'a', inputs: ['String'] }), fn({ id: 'b', inputs: ['string | null'] }))).toBe(true);
  });

  it('lets unknown act as a wildcard rather than blocking a match', () => {
    expect(isCompatible(fn({ id: 'a', outputs: ['unknown'] }), fn({ id: 'b', outputs: ['string'] }))).toBe(true);
  });
});

describe('findCandidateClusters', () => {
  it('groups near-identical fingerprints and ignores the unrelated one', () => {
    const clusters = findCandidateClusters([
      fn({ id: 'phone-1', embedding: vectorAt(0) }),
      fn({ id: 'phone-2', embedding: vectorAt(0.05) }),
      fn({ id: 'phone-3', embedding: vectorAt(0.1) }),
      fn({ id: 'slugify', embedding: vectorAt(1.5) }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(['phone-1', 'phone-2', 'phone-3']);
    expect(clusters[0].cohesion).toBeGreaterThan(0.86);
  });

  it('never emits a singleton', () => {
    expect(findCandidateClusters([fn({ id: 'only' })])).toEqual([]);
    expect(findCandidateClusters([fn({ id: 'a', embedding: vectorAt(0) }), fn({ id: 'b', embedding: vectorAt(1.5) })])).toEqual([]);
  });

  it('does not chain unrelated ends together (A and C never share a cluster)', () => {
    // a-b and b-c are each ~0.878; a-c is only ~0.540. Single-linkage would
    // chain all three via b. Average-linkage must not: once a pair forms, the
    // third joins only if its mean link clears the threshold, and avg(0.540,
    // 0.878) = 0.709 < 0.86 does not. So a and c are never grouped together.
    const clusters = findCandidateClusters(
      [
        fn({ id: 'a', embedding: vectorAt(0) }),
        fn({ id: 'b', embedding: vectorAt(0.5) }),
        fn({ id: 'c', embedding: vectorAt(1.0) }),
      ],
      { threshold: 0.86, mergeFloor: 0.5 }
    );

    expect(cosineSimilarity(vectorAt(0), vectorAt(1.0))).toBeLessThan(0.86);
    for (const cluster of clusters) {
      const hasA = cluster.memberIds.includes('a');
      const hasC = cluster.memberIds.includes('c');
      expect(hasA && hasC).toBe(false);
    }
  });

  it('THE BUG-2 REGRESSION: clusters divergent members even when a pair is below threshold', () => {
    // The four cline `truncateText` implementations do the same job but differ,
    // so some of their pairwise similarities are LOW — measured as low as 0.66.
    // Complete-linkage split them and the money-shot cluster never formed.
    // Average-linkage must hold them together on the strength of the group mean.
    const members = [
      fn({ id: 't1', embedding: vectorAt(0) }),
      fn({ id: 't2', embedding: vectorAt(0.35) }),
      fn({ id: 't3', embedding: vectorAt(0.55) }),
      fn({ id: 't4', embedding: vectorAt(0.75) }),
    ];

    // The widest pair, t1-t4, is genuinely below the 0.75 merge threshold...
    const weakestPair = cosineSimilarity(vectorAt(0), vectorAt(0.75));
    expect(weakestPair).toBeLessThan(0.75);

    const clusters = findCandidateClusters(members); // default threshold 0.75

    // ...yet all four land in ONE candidate cluster, because the group mean holds.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('never hands the adjudicator more bodies than it is allowed to see', () => {
    // Ten functions all essentially identical: without the cap this is one
    // group of ten and a blown per-call token budget.
    const identical = Array.from({ length: 10 }, (_v, i) =>
      fn({ id: `dup-${i}`, embedding: vectorAt(i * 0.001) })
    );
    const clusters = findCandidateClusters(identical);

    expect(clusters.length).toBeGreaterThan(0);
    for (const cluster of clusters) {
      expect(cluster.memberIds.length).toBeLessThanOrEqual(MAX_CLUSTER_SIZE);
      expect(cluster.memberIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('splits groups that the compatibility filter says cannot match', () => {
    // Same behaviour vector, but one is impure — they must not be compared.
    const clusters = findCandidateClusters([
      fn({ id: 'pure-1', embedding: vectorAt(0) }),
      fn({ id: 'pure-2', embedding: vectorAt(0.01) }),
      fn({ id: 'impure-1', embedding: vectorAt(0), isPure: false }),
      fn({ id: 'impure-2', embedding: vectorAt(0.01), isPure: false }),
    ]);

    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      const allPure = cluster.memberIds.every((id) => id.startsWith('pure'));
      const allImpure = cluster.memberIds.every((id) => id.startsWith('impure'));
      expect(allPure || allImpure).toBe(true);
    }
  });

  it('returns clusters sorted by cohesion and honours the cluster cap', () => {
    // Ten mutually-orthogonal families of two members each. Different families
    // share no dimension, so they never merge; within a family the two members
    // are nearly identical.
    const family = (dim: number, jitter: number): number[] => {
      const v = new Array(12).fill(0);
      v[dim] = 1;
      v[(dim + 1) % 12] = jitter;
      return v;
    };
    const functions: ClusterableFunction[] = [];
    for (let d = 0; d < 10; d += 1) {
      functions.push(fn({ id: `f${d}-a`, embedding: family(d, 0.01 * (d + 1)) }));
      functions.push(fn({ id: `f${d}-b`, embedding: family(d, 0.02 * (d + 1)) }));
    }

    const clusters = findCandidateClusters(functions, { maxClusters: 5 });

    expect(clusters).toHaveLength(5); // 10 clusters would form; the cap keeps 5
    for (const cluster of clusters) expect(cluster.memberIds).toHaveLength(2);
    const cohesions = clusters.map((c) => c.cohesion);
    expect([...cohesions].sort((a, b) => b - a)).toEqual(cohesions);
  });

  it('prioritises cross-module Type-4 clones over same-file exact duplicates', () => {
    // Two exact-copy pairs inside one file (high cohesion, but jscpd's job), and
    // one cross-module pair of genuinely-different implementations (lower
    // cohesion, but the whole point of Ditto). With a cap of 1, the cross-module
    // clone must win the single adjudication slot.
    const exactA = [
      fn({ id: 'x1', embedding: vectorAt(0.5), file: 'src/a/dup.ts' }),
      fn({ id: 'x2', embedding: vectorAt(0.5001), file: 'src/a/dup.ts' }),
    ];
    const exactB = [
      fn({ id: 'y1', embedding: vectorAt(1.5), file: 'src/a/dup.ts' }),
      fn({ id: 'y2', embedding: vectorAt(1.5001), file: 'src/a/dup.ts' }),
    ];
    const crossModule = [
      fn({ id: 'p', embedding: vectorAt(2.5), file: 'src/auth/phone.ts' }),
      fn({ id: 'q', embedding: vectorAt(2.55), file: 'src/billing/phone.ts' }),
    ];

    const clusters = findCandidateClusters([...exactA, ...exactB, ...crossModule], { maxClusters: 1 });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(['p', 'q']);
    expect(clusters[0].moduleCount).toBe(2);
  });

  it('ignores functions that never got an embedding', () => {
    const clusters = findCandidateClusters([
      fn({ id: 'a', embedding: vectorAt(0) }),
      fn({ id: 'b', embedding: vectorAt(0.01) }),
      fn({ id: 'failed', embedding: [] }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds).not.toContain('failed');
  });
});
