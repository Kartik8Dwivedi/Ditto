/**
 * The fixture "database".
 *
 * Only `services/ditto.api.ts` should import this — everything else goes
 * through the API client, so the swap to the real backend touches one file.
 *
 * `node lib/mocks/audit.mjs` checks everything in here for internal
 * consistency. Run it after editing a fixture.
 */
import type { ClusterDetail, RepoDetail, RepoSummary } from '@/types/ditto';
import { CLINE_CLUSTERS } from './clusters.cline';
import { ACTUAL_CLUSTERS, ACTUAL_REPO, ACTUAL_STATS } from './clusters.actual';
import { DITTO_CLUSTERS, DITTO_REPO, DITTO_STATS } from './clusters.ditto';
import { CLINE_REPO, CLINE_STATS } from './repos';
import { sortByRisk, toSummary } from './derive';

type MockRepo = RepoDetail & { details: ClusterDetail[] };

const REPOS: MockRepo[] = [
  {
    repo: CLINE_REPO,
    stats: CLINE_STATS,
    clusters: sortByRisk(CLINE_CLUSTERS.map(toSummary)),
    details: CLINE_CLUSTERS,
  },
  {
    repo: ACTUAL_REPO,
    stats: ACTUAL_STATS,
    clusters: sortByRisk(ACTUAL_CLUSTERS.map(toSummary)),
    details: ACTUAL_CLUSTERS,
  },
  {
    repo: DITTO_REPO,
    stats: DITTO_STATS,
    clusters: sortByRisk(DITTO_CLUSTERS.map(toSummary)),
    details: DITTO_CLUSTERS,
  },
];

/** Exposed for lib/mocks/audit.mjs. Not part of the API surface. */
export const REPOS_FOR_AUDIT = REPOS;

export function getMockRepos(): RepoSummary[] {
  return REPOS.map((entry) => entry.repo);
}

export function getMockRepo(repoId: string): RepoDetail | undefined {
  const entry = REPOS.find((r) => r.repo.id === repoId);
  if (!entry) return undefined;
  return { repo: entry.repo, stats: entry.stats, clusters: entry.clusters };
}

export function getMockCluster(clusterId: string): ClusterDetail | undefined {
  for (const entry of REPOS) {
    const cluster = entry.details.find((c) => c.id === clusterId);
    if (cluster) return cluster;
  }
  return undefined;
}
