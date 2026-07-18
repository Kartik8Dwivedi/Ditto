import { RepoRepository, FunctionRepository, ClusterRepository } from '../Repository/index.js';
import type {
  ClusterDetail,
  ClusterSummary,
  ICluster,
  IFunction,
  RepoStats,
  RepoSummary,
} from '../Models/index.js';
import type { HydratedDocument } from 'mongoose';

/**
 * The read side — everything the Intelligence Map and cluster detail view need.
 *
 * The pipeline runs locally and writes results to Mongo; this service only
 * shapes what is already there into the payloads the frontend codes against. No
 * model calls happen here, which is why the demo costs ₹0 and cannot fail live.
 */

interface IntelligenceServiceDeps {
  repoRepository?: RepoRepository;
  functionRepository?: FunctionRepository;
  clusterRepository?: ClusterRepository;
}

const toRepoSummary = (repo: HydratedDocument<IRepoLike>): RepoSummary => ({
  id: repo._id.toString(),
  owner: repo.owner,
  name: repo.name,
  commit: repo.commit,
  indexedAt: repo.indexedAt.toISOString(),
});

interface IRepoLike {
  owner: string;
  name: string;
  commit: string;
  indexedAt: Date;
  stats: RepoStats;
}

/** True only when we really ran the code AND it really disagreed. */
const hasProvenDivergence = (cluster: HydratedDocument<ICluster>): boolean =>
  cluster.divergence?.executed === true && cluster.divergence.rows.some((row) => row.diverged);

const linesRemovableFor = (
  cluster: HydratedDocument<ICluster>,
  locById: Map<string, number>
): number =>
  cluster.functionIds
    .map((id) => id.toString())
    .filter((id) => id !== cluster.canonicalId.toString())
    .reduce((sum, id) => sum + (locById.get(id) ?? 0), 0);

const toClusterSummary = (
  cluster: HydratedDocument<ICluster>,
  locById: Map<string, number>
): ClusterSummary => ({
  id: cluster._id.toString(),
  domain: cluster.domain,
  behaviorSummary: cluster.behaviorSummary,
  memberCount: cluster.functionIds.length,
  confidence: cluster.confidence,
  disagreementRisk: cluster.disagreementRisk,
  hasProvenDivergence: hasProvenDivergence(cluster),
  linesRemovable: linesRemovableFor(cluster, locById),
});

class IntelligenceService {
  private readonly repoRepository: RepoRepository;
  private readonly functionRepository: FunctionRepository;
  private readonly clusterRepository: ClusterRepository;

  constructor({
    repoRepository = new RepoRepository(),
    functionRepository = new FunctionRepository(),
    clusterRepository = new ClusterRepository(),
  }: IntelligenceServiceDeps = {}) {
    this.repoRepository = repoRepository;
    this.functionRepository = functionRepository;
    this.clusterRepository = clusterRepository;
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos = await this.repoRepository.findAllSnapshots();
    return repos.map(toRepoSummary);
  }

  /**
   * The Intelligence Map payload: the repo, its stats, and its clusters.
   *
   * The only thing this needs from the function collection is a line count per
   * CLUSTER MEMBER, so it reads exactly that. Loading the repo's whole function
   * set here (2654 documents for cline, each with a full source body and a
   * 1536-float embedding) cost ~6.5s and ~30MB to extract a few hundred
   * integers. Stats are denormalised onto the repo document, so they need no
   * query at all.
   */
  async getRepoDetail(repoId: string): Promise<{
    repo: RepoSummary;
    stats: RepoStats;
    clusters: ClusterSummary[];
  }> {
    const [repo, clusters] = await Promise.all([
      this.repoRepository.findByIdOrFail(repoId),
      this.clusterRepository.findByRepo(repoId),
    ]);

    // Only members can contribute removable lines, and clusters are a small
    // fraction of a repo — so this scales with findings, not repo size.
    const memberIds = [
      ...new Set(clusters.flatMap((cluster) => cluster.functionIds.map((id) => id.toString()))),
    ];
    const locs = await this.functionRepository.findLocsByIds(memberIds);
    const locById = new Map(locs.map((fn) => [fn._id.toString(), fn.loc]));

    return {
      repo: toRepoSummary(repo),
      stats: repo.stats,
      clusters: clusters.map((cluster) => toClusterSummary(cluster, locById)),
    };
  }

  /** One cluster: the summary, the member bodies, and the divergence table. */
  async getClusterDetail(clusterId: string): Promise<ClusterDetail> {
    const cluster = await this.clusterRepository.findByIdOrFail(clusterId);
    const ids = cluster.functionIds.map((id) => id.toString());
    // Bodies yes, embeddings no — same over-fetch as above, smaller blast radius.
    const members = await this.functionRepository.findByIdsForDisplay(ids);

    const locById = new Map(members.map((fn) => [fn._id.toString(), fn.loc]));
    const canonicalId = cluster.canonicalId.toString();

    // Preserve the cluster's member order; the canonical leads.
    const byId = new Map(members.map((fn) => [fn._id.toString(), fn]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((fn): fn is HydratedDocument<IFunction> => Boolean(fn))
      .sort((a, b) => {
        const aCanonical = a._id.toString() === canonicalId ? 0 : 1;
        const bCanonical = b._id.toString() === canonicalId ? 0 : 1;
        return aCanonical - bCanonical;
      });

    return {
      ...toClusterSummary(cluster, locById),
      members: ordered.map((fn) => ({
        id: fn._id.toString(),
        name: fn.name,
        file: fn.file,
        startLine: fn.startLine,
        endLine: fn.endLine,
        body: fn.body,
        loc: fn.loc,
        isPure: fn.isPure,
        isCanonical: fn._id.toString() === canonicalId,
      })),
      differences: cluster.differences,
      ...(cluster.divergence ? { divergence: cluster.divergence } : {}),
    };
  }
}

export default IntelligenceService;
