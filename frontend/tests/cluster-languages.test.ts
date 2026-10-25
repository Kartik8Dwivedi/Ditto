import { describe, expect, it } from 'vitest';

import { clusterLanguages } from '@/lib/cluster-languages';
import { type ClusterSummary } from '@/types/ditto';

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

describe('clusterLanguages', () => {
  it('returns the languages when present', () => {
    expect(clusterLanguages(cluster({ languages: ['ts', 'python'] }))).toEqual(['ts', 'python']);
  });

  it('returns an empty array when languages is missing', () => {
    expect(clusterLanguages(cluster())).toEqual([]);
  });

  it('returns an empty array when languages is empty', () => {
    expect(clusterLanguages(cluster({ languages: [] }))).toEqual([]);
  });
});