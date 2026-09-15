import { describe, expect, it } from 'vitest';

import { findingState } from '@/lib/pr-finding';
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
