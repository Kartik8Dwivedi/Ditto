/**
 * The Ditto API contract.
 *
 * PINNED — mirrors `docs/PRD_FRONTEND.md` §2 exactly. The backend session is
 * building against these same shapes. Do not change them without coordinating.
 */

/** Every API response is wrapped in this envelope. */
export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type RepoSummary = {
  id: string;
  owner: string;
  name: string;
  commit: string;
  indexedAt: string;
};

export type RepoStats = {
  functions: number;
  files: number;
  modules: number;
  semanticDuplicateClusters: number;
  behavioralConflicts: number;
  nearDuplicates: number;
  reusableUtilities: number;
  suspectedReinvented: number;
  linesRemovable: number;
  callSitesUnifiable: number;
  /** 0-100 */
  healthScore: number;
  /**
   * Honest truncation signal (docs/ONDEMAND.md). The live pipeline caps how many
   * functions it analyses; when it does, `functionsAnalyzed < functionsTotal`
   * and the map shows a truncation note. For fully-analysed repos they are equal
   * and no note appears. Never hardcode a cap — read these.
   */
  functionsTotal: number;
  functionsAnalyzed: number;
};

/**
 * How badly the members of a cluster disagree.
 * - `none`     — they behave identically on every probed input.
 * - `cosmetic` — they differ, but only in presentation (separators, casing).
 * - `semantic` — they differ in meaning. This is a latent bug.
 */
export type DisagreementRisk = 'none' | 'cosmetic' | 'semantic';

export type ClusterSummary = {
  id: string;
  domain: string;
  behaviorSummary: string;
  memberCount: number;
  /** 0-1 */
  confidence: number;
  disagreementRisk: DisagreementRisk;
  hasProvenDivergence: boolean;
  linesRemovable: number;
};

export type ClusterMember = {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  body: string;
  loc: number;
  isPure: boolean;
  isCanonical: boolean;
};

export type DivergenceResult = {
  functionId: string;
  output: string;
  error?: string;
};

export type DivergenceRow = {
  input: string;
  results: DivergenceResult[];
  diverged: boolean;
};

export type Divergence = {
  /**
   * ⚠️ LOAD-BEARING HONESTY FLAG.
   * `true`  — these functions were really executed; `output` is real.
   * `false` — the outputs are LLM-predicted and must never be shown as real.
   */
  executed: boolean;
  rows: DivergenceRow[];
};

export type ClusterDetail = ClusterSummary & {
  members: ClusterMember[];
  differences: string[];
  divergence?: Divergence;
};

/** Response body of `GET /api/v1/repos/:repoId`. */
export type RepoDetail = {
  repo: RepoSummary;
  stats: RepoStats;
  clusters: ClusterSummary[];
};

/* ------------------------------------------------------------------ *
 * On-demand analysis (docs/ONDEMAND.md).
 *
 * A pasted GitHub URL becomes a background Job. The frontend polls it and
 * drives the pipeline stepper from `stage`, then navigates to `repoId` on done.
 * ------------------------------------------------------------------ */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * Mirrors the PIPELINE_STAGES ids in `lib/constants.ts` (plus the two terminal
 * meta-states) so the stepper can light up live from `job.stage`.
 */
export type JobStage =
  | 'queued'
  | 'fetch'
  | 'parse'
  | 'fingerprint'
  | 'embed'
  | 'cluster'
  | 'adjudicate'
  | 'probe'
  | 'done';

export type Job = {
  id: string;
  status: JobStatus;
  stage: JobStage | null;
  /** Set when done — the repo to navigate to. */
  repoId: string | null;
  /** Human-readable, set when failed. */
  error: string | null;
  /** Total functions the AST index found. */
  functionsTotal: number | null;
  /** How many were actually analysed (may be capped below the total). */
  functionsAnalyzed: number | null;
};

/**
 * Response of `POST /api/v1/analyze`. Exactly one of the two is set:
 *   { jobId, repoId: null } — a new analysis was queued; poll the job.
 *   { jobId: null, repoId } — dedup hit; this repo is already analysed, go now.
 */
export type AnalyzeResponse = {
  jobId: string | null;
  repoId: string | null;
};

/**
 * Below this confidence we refuse to make a hard "semantic duplicate" claim and
 * degrade the finding to a dashed "near-duplicate". Graceful degradation is our
 * defence against a wrong finding. See PRD §4.3.
 */
export const CONFIDENCE_CLAIM_THRESHOLD = 0.8;

export function isHardClaim(cluster: Pick<ClusterSummary, 'confidence'>): boolean {
  return cluster.confidence >= CONFIDENCE_CLAIM_THRESHOLD;
}
