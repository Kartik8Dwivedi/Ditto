import type { JobStage } from '@/types/ditto';

/**
 * The pipeline stages, in the order the backend really runs them.
 *
 * Each `id` is a `JobStage` (docs/ONDEMAND.md), so the stepper can light up live
 * from a job's `stage` field. The two terminal meta-stages — `queued` (before
 * work starts) and `done` (navigate away) — are not rows here; they are handled
 * by the progress view around the stepper.
 */
export const PIPELINE_STAGES = [
  { id: 'fetch', label: 'Fetching repository', detail: 'downloading the GitHub tarball' },
  { id: 'parse', label: 'Parsing AST', detail: 'ts-morph walk over every function, method and arrow' },
  { id: 'fingerprint', label: 'Fingerprinting functions', detail: 'one LLM call per function, constant context' },
  { id: 'embed', label: 'Embedding fingerprints', detail: 'intent and behaviour — never the function name' },
  { id: 'cluster', label: 'Clustering', detail: 'cosine similarity + signature/purity compatibility' },
  { id: 'adjudicate', label: 'Adjudicating clusters', detail: 'flagship model reads one cluster at a time' },
  { id: 'probe', label: 'Probing for divergence', detail: 'executing pure members on adversarial inputs' },
] as const satisfies ReadonlyArray<{ id: JobStage; label: string; detail: string }>;

/**
 * Where a `JobStage` sits in the stepper.
 *   'queued'         -> -1 (nothing running yet)
 *   a pipeline stage -> its row index
 *   'done'           -> length (every row complete)
 * Returns null for an unrecognised stage so the caller can fall back safely.
 */
export function stageIndex(stage: JobStage | null | undefined): number | null {
  if (stage === 'queued' || stage == null) return -1;
  if (stage === 'done') return PIPELINE_STAGES.length;
  const i = PIPELINE_STAGES.findIndex((s) => s.id === stage);
  return i === -1 ? null : i;
}
