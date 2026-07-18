/**
 * Ordering for the "Indexed Repositories" cards.
 *
 * Most interesting first: proven divergences, then cluster count, then function
 * count. Entirely data-driven — there is no hero list. A newly analysed repo
 * with real findings rises on its own; a clean library sinks on its own.
 */
import type { ClusterSummary, RepoDetail, RepoStats, RepoSummary } from '@/types/ditto';

export type RankedRepo = {
  repo: RepoSummary;
  /** null when the detail fetch failed — the card still renders, without metrics. */
  stats: RepoStats | null;
  /** Clusters Ditto executed and proved disagree. */
  provenDivergences: number;
};

/**
 * The number a reader can verify by counting the "they disagree" rows on the
 * map. Deliberately derived from the cluster list rather than read from
 * `stats.behavioralConflicts`, which counts something broader and does not
 * match the rows on screen.
 */
export function countProvenDivergences(clusters: ClusterSummary[]): number {
  return clusters.filter((c) => c.hasProvenDivergence).length;
}

export function toRanked(detail: RepoDetail): RankedRepo {
  return {
    repo: detail.repo,
    stats: detail.stats,
    provenDivergences: countProvenDivergences(detail.clusters),
  };
}

/** Sort comparator: most interesting first. */
export function byInterestingness(a: RankedRepo, b: RankedRepo): number {
  // A repo whose metrics we could not load sinks to the bottom — we cannot
  // claim it is interesting when we do not know anything about it.
  if ((a.stats === null) !== (b.stats === null)) return a.stats === null ? 1 : -1;

  if (a.provenDivergences !== b.provenDivergences) {
    return b.provenDivergences - a.provenDivergences;
  }

  const clusters = (r: RankedRepo) => r.stats?.semanticDuplicateClusters ?? 0;
  if (clusters(a) !== clusters(b)) return clusters(b) - clusters(a);

  const functions = (r: RankedRepo) => r.stats?.functions ?? 0;
  if (functions(a) !== functions(b)) return functions(b) - functions(a);

  // Stable, alphabetical tie-break so the order never flickers between renders.
  return `${a.repo.owner}/${a.repo.name}`.localeCompare(`${b.repo.owner}/${b.repo.name}`);
}

export function rankRepos(entries: RankedRepo[]): RankedRepo[] {
  return [...entries].sort(byInterestingness);
}
