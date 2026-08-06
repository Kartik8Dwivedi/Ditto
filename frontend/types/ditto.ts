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
  /**
   * Provenance (docs/RESUME_BUILD.md §3.3). `'pr'` marks the function a pull
   * request introduced or changed; `'baseline'` is the already-indexed impl it
   * reinvents. Absent on the ordinary repo-map path. Every existing renderer
   * keeps working; the PR surface uses `origin === 'pr'` to badge the new one.
   */
  origin?: 'baseline' | 'pr';
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
  /**
   * Present only on a per-PR job (docs/RESUME_BUILD.md §3.2). The existing
   * job→poll→stepper machinery is reused unchanged; this optional block just
   * carries the PR context so the progress view can label it.
   */
  pr?: {
    prNumber: number;
    headSha: string;
    baseSha: string;
    headRef: string;
    /** Count kept after the diff-range filter. */
    changedFunctions: number;
    /** True if the base repo had to be full-indexed before the PR ran. */
    indexedOnDemand: boolean;
  };
  /**
   * Set on done for a PR job — the analysis to navigate to (§3.2), alongside or
   * instead of `repoId`. The progress view routes to `/pr/:prAnalysisId`.
   */
  prAnalysisId?: string;
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

/* ------------------------------------------------------------------ *
 * Per-PR analysis (docs/RESUME_BUILD.md §3.4).
 *
 * A PR result is expressed with the existing cluster/member/divergence shapes
 * plus a provenance flag, so the current rendering components work with
 * near-zero change. These mirror the backend byte-for-byte — do not change one
 * side without the other.
 * ------------------------------------------------------------------ */

/**
 * Response of `POST /api/v1/pr`. Exactly one of the two is set (§3.1):
 *   { jobId, prAnalysisId: null } — analysis queued; poll the job.
 *   { jobId: null, prAnalysisId } — dedup hit (same headSha); results ready.
 */
export type PrAnalyzeResponse = {
  jobId: string | null;
  prAnalysisId: string | null;
};

/** Where a function lives — the identity of a PR fn or the impl it reinvents. */
export type PrFunctionRef = {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
};

export type PrFinding = {
  /** The function this PR introduced or changed. */
  newFunction: PrFunctionRef;
  /** The already-indexed implementation it reinvents, or null when novel. */
  match: PrFunctionRef | null;
  verdict: 'duplicate' | 'near-duplicate' | 'novel';
  /** Cosine similarity between the PR fn and its match. */
  similarity: number;
  /** Adjudicator confidence. */
  confidence: number;
  /** Modules importing the existing impl. */
  usedBy: string[];
  /**
   * An EXECUTED divergence table when both sides are pure; null otherwise.
   * Never fabricated: if `proof !== 'executed'` this is null.
   */
  divergence: Divergence | null;
  /**
   * ⚠️ LOAD-BEARING HONESTY FLAG — drives the truth badge.
   * `'executed'`  — both pure, really run, `divergence` is real.
   * `'suspected'` — a side is impure; the model suspects but nothing was proven.
   * `'none'`      — nothing to prove (e.g. a novel function with no match).
   */
  proof: 'executed' | 'suspected' | 'none';
};

export type PrAnalysis = {
  id: string;
  owner: string;
  name: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  prUrl: string;
  changedFunctions: number;
  /** One per changed function that matched (novel ones optional). */
  findings: PrFinding[];
  createdAt: string;
};
