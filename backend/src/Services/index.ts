export { default as CrudService } from './crud.service.js';
export { default as ResourceService } from './resource.service.js';

export { default as OpenAIService, UsageMeter } from './openai.service.js';
export type { ModelUsage, StructuredRequest } from './openai.service.js';

export { default as FingerprintService, FINGERPRINT_CONCURRENCY } from './fingerprint.service.js';
export type { FingerprintBatchResult } from './fingerprint.service.js';

export { default as EmbeddingService, buildEmbedText } from './embedding.service.js';
export type { EmbeddingBatchResult } from './embedding.service.js';

export {
  cosineSimilarity,
  findCandidateClusters,
  isCompatible,
  SIMILARITY_THRESHOLD,
  MERGE_FLOOR,
  MAX_CLUSTER_SIZE,
  MAX_CANDIDATE_CLUSTERS,
} from './cluster.service.js';
export type { CandidateCluster, ClusterableFunction, ClusterOptions } from './cluster.service.js';

export {
  computeRepoStats,
  healthScore,
  moduleOf,
  isConfirmed,
  CONFIDENCE_THRESHOLD,
} from './stats.service.js';
export type { HealthScoreInput, RepoStatsOptions, StatsCluster, StatsFunction } from './stats.service.js';

export { default as AdjudicateService, ADJUDICATE_CONCURRENCY } from './adjudicate.service.js';
export type { AdjudicatedCluster, AdjudicationMember } from './adjudicate.service.js';

export { default as ProbeService, buildRows, PROBE_TIMEOUT_MS } from './probe.service.js';
export type { ProbeCell, ProbeMember } from './probe.service.js';

export { default as GuardService, GUARD_SEARCH_FLOOR } from './guard.service.js';
export type { GuardCheckInput } from './guard.service.js';

export { default as IntelligenceService } from './intelligence.service.js';

export { default as PipelineService } from './pipeline.service.js';
export type { PipelineOptions, PipelineReport } from './pipeline.service.js';

export { IndexerService, cacheFileFor, DEFAULT_CACHE_DIR } from './indexer/index.js';
export type { CacheFile, ExtractResult, IndexOptions, IndexReport } from './indexer/index.js';

export { default as TasksService } from './tasks.service.js';

export { default as AnalysisService, LIVE_MAX_FUNCTIONS, LIVE_CANDIDATE_CAP, LIVE_HARD_CEILING, LIVE_ANALYSIS_CAP } from './analysis.service.js';
export type { AnalyzeResult } from './analysis.service.js';
