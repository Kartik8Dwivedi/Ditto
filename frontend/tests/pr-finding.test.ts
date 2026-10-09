import { describe, expect, it } from 'vitest';

import { findingState, findingToCluster } from '@/lib/pr-finding';
import { verdictFor } from '@/lib/cluster-verdict';
import type { PrFinding } from '@/types/ditto';

const functionRef = {
  name: 'slugify',
  file: 'src/slug.ts',
  startLine: 1,
  endLine: 5,
};

const finding = (overrides: Partial<PrFinding> = {}): PrFinding => ({
  newFunction: functionRef,
  match: { ...functionRef, name: 'existingSlugify' },
  verdict: 'duplicate',
  similarity: 0.95,
  confidence: 0.9,
  usedBy: [],
  divergence: null,
  proof: 'suspected',
  ...overrides,
});

describe('findingState', () => {
  it.each([
    [{ verdict: 'novel', proof: 'none' }, 'novel'],
    [{ match: null, verdict: 'duplicate' }, 'novel'],
    [{ proof: 'executed' }, 'proven'],
    [{ proof: 'suspected' }, 'suspected'],
    [{ proof: 'none' }, 'suspected'],
  ] as const)('maps %j to %s', (overrides, expected) => {
    expect(findingState(finding(overrides))).toBe(expected);
  });
});

describe('findingToCluster hard-claim authority', () => {
  it('asserts a finding with verdict: "near-duplicate" is never rendered as a hard claim regardless of its confidence value, and one with verdict: "duplicate" always is', () => {
    const nearDuplicateHighConf = finding({
      verdict: 'near-duplicate',
      confidence: 0.99,
    });
    const nearCluster = findingToCluster(nearDuplicateHighConf, 0);
    expect(verdictFor(nearCluster).isHardClaim).toBe(false);
    expect(verdictFor(nearCluster).label).toBe('Near-duplicate');

    const duplicateLowConf = finding({
      verdict: 'duplicate',
      confidence: 0.5,
    });
    const dupCluster = findingToCluster(duplicateLowConf, 0);
    expect(verdictFor(dupCluster).isHardClaim).toBe(true);
    expect(verdictFor(dupCluster).label).not.toBe('Near-duplicate');
  });
});
