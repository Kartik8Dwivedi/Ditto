/**
 * The two repo-level conflict numbers — and the rule that they are NEVER the
 * same thing.
 *
 *   SUSPECTED  `stats.behavioralConflicts`
 *              Clusters the adjudicator flagged as semantically risky.
 *              A model's opinion. Nothing was executed.
 *
 *   PROVEN     clusters where `hasProvenDivergence === true`
 *              Ditto ran these on the same inputs and watched them disagree.
 *              This is the number a judge can verify by counting the
 *              "they disagree" rows on the map.
 *
 * For cline these are 50 and 11. Labelling 50 as "proven" would overclaim on
 * the exact word the whole pitch rests on, so every surface reads both from
 * here rather than inventing its own wording.
 *
 * Saying "50 suspected, 11 proven by execution" is stronger than a vague 50:
 * it shows we know the difference between what we suspect and what we proved.
 */
import type { ClusterSummary, RepoStats } from '@/types/ditto';

export const SUSPECTED_LABEL = 'Suspected Conflicts';
export const PROVEN_LABEL = 'Proven by Execution';

export const SUSPECTED_HELP =
  'Clusters the adjudicator flagged as semantically risky. Suspected, not executed — this is a model judgement, not proof.';
export const PROVEN_HELP =
  'Clusters Ditto actually executed on the same inputs and observed returning different answers. Count the "they disagree" rows below and you get this number.';

/** Adjudicator-flagged semantic risk. NOT executed. */
export function countSuspectedConflicts(stats: RepoStats): number {
  return stats.behavioralConflicts;
}

/** Executed and observed to disagree. Verifiable by counting rows. */
export function countProvenDivergences(clusters: ClusterSummary[]): number {
  return clusters.filter((c) => c.hasProvenDivergence).length;
}
