import type { ClusterSummary } from '@/types/ditto';

/**
 * Language badges for a cluster row.
 *
 * An absent (or empty) `languages` field means "we do not know" — render no
 * badge at all rather than asserting a default language. Only non-empty arrays
 * produce badges.
 */
export function clusterLanguages(cluster: ClusterSummary): Array<'ts' | 'python'> {
  return cluster.languages && cluster.languages.length > 0 ? cluster.languages : [];
}