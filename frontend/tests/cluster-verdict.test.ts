import { describe, expect, it } from 'vitest';

import { verdictFor } from '@/lib/cluster-verdict';
import { CONFIDENCE_CLAIM_THRESHOLD, type ClusterSummary } from '@/types/ditto';

const cluster = (overrides: Partial<ClusterSummary> = {}): ClusterSummary => ({
  id: 'cluster-1',
  domain: 'slugify',
  behaviorSummary: 'Normalizes a title into a slug',
  memberCount: 2,
  confidence: 0.9,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 12,
  ...overrides,
});

describe('verdictFor', () => {
  it.each([
    [{ disagreementRisk: 'semantic', hasProvenDivergence: true }, 'Semantic conflict', 'danger', false, true],
    [{ disagreementRisk: 'semantic', hasProvenDivergence: false }, 'Suspected conflict', 'ai', true, true],
    [{ disagreementRisk: 'cosmetic', hasProvenDivergence: true }, 'Cosmetic diff', 'warn', false, true],
    [{ disagreementRisk: 'none', hasProvenDivergence: false }, 'No disagreement', 'success', false, true],
  ] as const)(
    'maps %j to %s',
    (overrides, label, tone, dashed, isHardClaim) => {
      expect(verdictFor(cluster(overrides))).toMatchObject({ label, tone, dashed, isHardClaim });
    },
  );

  it.each([
    [CONFIDENCE_CLAIM_THRESHOLD - 0.001, 'Near-duplicate', 'neutral', true, false],
    [CONFIDENCE_CLAIM_THRESHOLD, 'Semantic conflict', 'danger', false, true],
  ] as const)(
    'handles the confidence threshold boundary at %s',
    (confidence, label, tone, dashed, isHardClaim) => {
      expect(
        verdictFor(cluster({ confidence, disagreementRisk: 'semantic', hasProvenDivergence: true })),
      ).toMatchObject({ label, tone, dashed, isHardClaim });
    },
  );
});
