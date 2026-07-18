/**
 * Keeps the fixture stats honest.
 *
 * The three numbers a judge can actually verify by counting the cluster list —
 * how many clusters, how many proven conflicts, how many lines are removable —
 * are computed from the clusters rather than typed in. Edit a cluster and the
 * headline follows. It cannot drift into a claim the data does not support.
 */
import type { ClusterDetail, ClusterSummary, RepoStats } from '@/types/ditto';

/**
 * The parts of RepoStats that cannot be derived from the cluster list.
 * `functionsTotal`/`functionsAnalyzed` are optional in the seed and default to
 * `functions` — i.e. these fixtures represent fully-analysed repos, so the
 * truncation note never shows for them.
 */
type StatsSeed = Omit<
  RepoStats,
  | 'semanticDuplicateClusters'
  | 'behavioralConflicts'
  | 'linesRemovable'
  | 'functionsTotal'
  | 'functionsAnalyzed'
> &
  Partial<Pick<RepoStats, 'functionsTotal' | 'functionsAnalyzed'>>;

export function deriveStats(clusters: ClusterDetail[], seed: StatsSeed): RepoStats {
  const { functionsTotal, functionsAnalyzed, ...rest } = seed;
  return {
    ...rest,
    functionsTotal: functionsTotal ?? seed.functions,
    functionsAnalyzed: functionsAnalyzed ?? seed.functions,
    semanticDuplicateClusters: clusters.length,
    behavioralConflicts: clusters.filter((c) => c.hasProvenDivergence).length,
    linesRemovable: clusters.reduce((total, c) => total + c.linesRemovable, 0),
  };
}

/** Strip a ClusterDetail down to the summary shape the repo endpoint returns. */
export function toSummary(cluster: ClusterDetail): ClusterSummary {
  return {
    id: cluster.id,
    domain: cluster.domain,
    behaviorSummary: cluster.behaviorSummary,
    memberCount: cluster.memberCount,
    confidence: cluster.confidence,
    disagreementRisk: cluster.disagreementRisk,
    hasProvenDivergence: cluster.hasProvenDivergence,
    linesRemovable: cluster.linesRemovable,
  };
}

/** Risk-first ordering — the map is sorted by "how much should I care". */
const RISK_RANK: Record<ClusterSummary['disagreementRisk'], number> = {
  semantic: 0,
  cosmetic: 1,
  none: 2,
};

export function sortByRisk(clusters: ClusterSummary[]): ClusterSummary[] {
  return [...clusters].sort((a, b) => {
    // Proven conflicts always outrank suspected ones at the same risk level.
    const risk = RISK_RANK[a.disagreementRisk] - RISK_RANK[b.disagreementRisk];
    if (risk !== 0) return risk;
    if (a.hasProvenDivergence !== b.hasProvenDivergence) {
      return a.hasProvenDivergence ? -1 : 1;
    }
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.linesRemovable - a.linesRemovable;
  });
}
