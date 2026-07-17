/**
 * The single source of truth for what Ditto is willing to CLAIM about a cluster.
 *
 * Every surface — the map row, the drawer header, the divergence table — asks
 * this module, so the colour language stays consistent and, more importantly,
 * so the honesty rules are enforced in exactly one place:
 *
 *   · confidence < 0.8  → we are not sure these are even the same thing, so we
 *     degrade to a dashed "near-duplicate" lead and never make a hard claim.
 *   · not executed      → the model suspects; it has not proven. 🤖, never 🔴.
 *   · cosmetic          → amber. Calling a separator change a bug is crying wolf.
 *   · semantic + proven → 🔴. This is the one we want believed.
 */
import type { BadgeTone } from '@/components/ui/badge';
import { CONFIDENCE_CLAIM_THRESHOLD, type ClusterSummary } from '@/types/ditto';

export type ClusterVerdict = {
  label: string;
  tone: BadgeTone;
  dashed: boolean;
  /** False when we are showing a lead rather than asserting a duplicate. */
  isHardClaim: boolean;
  blurb: string;
};

export function verdictFor(cluster: ClusterSummary): ClusterVerdict {
  if (cluster.confidence < CONFIDENCE_CLAIM_THRESHOLD) {
    return {
      label: 'Near-duplicate',
      tone: 'neutral',
      dashed: true,
      isHardClaim: false,
      blurb:
        'Below our confidence bar. These may not be the same thing at all, so Ditto reports a lead to look at rather than a duplicate to fix.',
    };
  }

  if (cluster.disagreementRisk === 'semantic') {
    return cluster.hasProvenDivergence
      ? {
          label: 'Semantic conflict',
          tone: 'danger',
          dashed: false,
          isHardClaim: true,
          blurb:
            'These implementations were executed on the same inputs and returned different answers. This is a latent bug.',
        }
      : {
          label: 'Suspected conflict',
          tone: 'ai',
          dashed: true,
          isHardClaim: true,
          blurb:
            'The model expects these to disagree, but they could not be safely executed, so nothing here is proven.',
        };
  }

  if (cluster.disagreementRisk === 'cosmetic') {
    return {
      label: 'Cosmetic diff',
      tone: 'warn',
      dashed: false,
      isHardClaim: true,
      blurb:
        'They really do return different strings, but the difference is presentational — a separator or an ellipsis, not a wrong answer.',
    };
  }

  return {
    label: 'No disagreement',
    tone: 'success',
    dashed: false,
    isHardClaim: true,
    blurb:
      'These agree on every input Ditto probed. Duplication worth consolidating, but not a bug.',
  };
}

/** The per-row verdict inside the divergence table. */
export function rowVerdictLabel(
  cluster: ClusterSummary,
  executed: boolean,
): string {
  if (!executed) return '✕ suspected';
  if (!verdictFor(cluster).isHardClaim) return '≠ differs';
  if (cluster.disagreementRisk === 'cosmetic') return '≠ cosmetic';
  return '✕ conflict';
}

/** Only a proven, confident, semantic disagreement is allowed to scream red. */
export function isProvenConflict(cluster: ClusterSummary, executed: boolean): boolean {
  return (
    executed &&
    cluster.disagreementRisk === 'semantic' &&
    verdictFor(cluster).isHardClaim &&
    cluster.hasProvenDivergence
  );
}
