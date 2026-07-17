import { z } from 'zod';

/**
 * THE PINNED DATA CONTRACT.
 *
 * These shapes cross agent/session boundaries — the indexer produces
 * `ExtractedFunction`, the frontend consumes the API response types. Changing
 * anything in this file is a breaking change for someone else. Don't.
 *
 * Zod schemas live beside the types because the same shapes are used three ways:
 *   1. validating what the indexer wrote to disk (untrusted input),
 *   2. constraining LLM output via strict Structured Outputs,
 *   3. typing the rest of the application.
 */

/* ------------------------------------------------------------------ *
 * Stage 0 — extraction (produced by Services/indexer, owned elsewhere)
 * ------------------------------------------------------------------ */

/**
 * One function as lifted out of the repo by the ts-morph extractor. This is the
 * indexer's output contract; we treat it as a read-only external API.
 */
export const ExtractedFunctionSchema = z.object({
  name: z.string(),
  /** Repo-relative path. */
  file: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  signature: z.string(),
  /** Raw source text of the function. */
  body: z.string(),
  /** sha256 of the whitespace-normalised body — the cache key for stages 1 & 2. */
  bodyHash: z.string(),
  loc: z.number().int(),
  isExported: z.boolean(),
  params: z.array(z.string()),
  returnTypeText: z.string(),
  /** Module specifiers the FILE imports. */
  imports: z.array(z.string()),
  /** Body references an imported identifier. */
  callsExternal: z.boolean(),
  /**
   * Safe to execute: mutates nothing outside itself, no I/O, no non-determinism,
   * no imported identifiers, no `this`/`await`, and returns a value. Reading
   * module-level state and calling same-file pure helpers are both allowed —
   * see Services/indexer/purity.ts.
   */
  isPure: z.boolean(),
  /**
   * Same-file declarations the body needs to run standalone in the prober's
   * sandbox. Additive and optional: a function with no same-file dependencies
   * has none, and only the prober reads it. `body` remains exactly the source
   * text, because that is what is displayed.
   */
  preamble: z.string().optional(),
});

export type ExtractedFunction = z.infer<typeof ExtractedFunctionSchema>;

/**
 * The on-disk shape of `backend/.cache/<owner>-<repo>.json`.
 *
 * Deliberately tolerant: the extractor may write a bare array of functions or
 * wrap them with repo metadata. Accepting both means the pipeline does not
 * break if the indexer's envelope changes shape around us.
 */
export const ExtractorCacheFileSchema = z.union([
  z.array(ExtractedFunctionSchema),
  z.object({
    owner: z.string().optional(),
    name: z.string().optional(),
    repo: z.string().optional(),
    commit: z.string().optional(),
    functions: z.array(ExtractedFunctionSchema),
  }),
]);

export type ExtractorCacheFile = z.infer<typeof ExtractorCacheFileSchema>;

/* ------------------------------------------------------------------ *
 * Stage 1 — fingerprint (LLM, cheap tier, one function per call)
 * ------------------------------------------------------------------ */

/**
 * A description of what a function DOES, deliberately stripped of how it is
 * written. This is the projection that lets `normalizePhone` and `formatMobile`
 * land in the same place in embedding space.
 */
export const FingerprintSchema = z.object({
  /** One line, observable behaviour. */
  intent: z.string(),
  /** e.g. ["string"] */
  inputs: z.array(z.string()),
  /** e.g. ["string"] */
  outputs: z.array(z.string()),
  /** [] for pure. */
  sideEffects: z.array(z.string()),
  /** e.g. "phone-number", "date", "currency" */
  domain: z.string(),
  /** Ordered observable steps. */
  behavior: z.array(z.string()),
  pure: z.boolean(),
});

export type Fingerprint = z.infer<typeof FingerprintSchema>;

/* ------------------------------------------------------------------ *
 * Stage 2 — adjudication (LLM, flagship, one candidate cluster per call)
 * ------------------------------------------------------------------ */

export const DisagreementRiskSchema = z.enum(['none', 'cosmetic', 'semantic']);
export type DisagreementRisk = z.infer<typeof DisagreementRiskSchema>;

/**
 * The slice of `Cluster` the flagship model actually produces. The rest
 * (`functionIds`, `divergence`) is ours: we already know who is in the cluster,
 * and divergence is measured, not predicted.
 *
 * No `.min()`/`.max()` here on purpose — numeric bounds are not reliably
 * supported by strict Structured Outputs across model versions, so `confidence`
 * is clamped in code after validation instead.
 */
export const AdjudicationSchema = z.object({
  sameBehavior: z.boolean(),
  canonicalId: z.string(),
  behaviorSummary: z.string(),
  differences: z.array(z.string()),
  disagreementRisk: DisagreementRiskSchema,
  /** 0-1. */
  confidence: z.number(),
  /** JSON-encoded ARG ARRAYS, e.g. '["00919876543210"]'. */
  probeInputs: z.array(z.string()),
});

export type Adjudication = z.infer<typeof AdjudicationSchema>;

/**
 * The result of running cluster members on the same inputs.
 *
 * `executed` is a truth flag rendered on screen. It is true ONLY when real code
 * really ran in the sandbox. A predicted table is not an executed table.
 */
export type DivergenceTable = {
  executed: boolean;
  rows: Array<{
    input: string;
    results: Array<{ functionId: string; output: string; error?: string }>;
    diverged: boolean;
  }>;
};

export type Cluster = {
  functionIds: string[];
  canonicalId: string;
  sameBehavior: boolean;
  behaviorSummary: string;
  differences: string[];
  disagreementRisk: DisagreementRisk;
  confidence: number;
  probeInputs: string[];
  divergence?: DivergenceTable;
};

/* ------------------------------------------------------------------ *
 * API response payloads (the frontend codes against these)
 * ------------------------------------------------------------------ */

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
  /** Clusters with disagreementRisk === 'semantic'. */
  behavioralConflicts: number;
  /** Below the confidence threshold. */
  nearDuplicates: number;
  /** Pure, exported, single-implementation. */
  reusableUtilities: number;
  suspectedReinvented: number;
  /** Sum of loc of non-canonical members. */
  linesRemovable: number;
  callSitesUnifiable: number;
  /** 0-100. */
  healthScore: number;
};

export type ClusterSummary = {
  id: string;
  domain: string;
  behaviorSummary: string;
  memberCount: number;
  confidence: number;
  disagreementRisk: DisagreementRisk;
  hasProvenDivergence: boolean;
  linesRemovable: number;
};

export type ClusterDetail = ClusterSummary & {
  members: Array<{
    id: string;
    name: string;
    file: string;
    startLine: number;
    endLine: number;
    body: string;
    loc: number;
    isPure: boolean;
    isCanonical: boolean;
  }>;
  differences: string[];
  divergence?: DivergenceTable;
};

export type GuardResult = {
  matches: Array<{
    newFunction: string;
    existingFunction: { id: string; name: string; file: string; startLine: number };
    similarity: number;
    confidence: number;
    usedBy: string[];
    verdict: 'duplicate' | 'near-duplicate' | 'novel';
  }>;
};
