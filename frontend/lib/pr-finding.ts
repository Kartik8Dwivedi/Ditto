/**
 * The single source of truth for what the PR surface is willing to CLAIM about
 * a finding — the PR-path sibling of `lib/cluster-verdict.ts`.
 *
 * The honesty rule (docs/RESUME_BUILD.md §0/§3.5) lives here so it is enforced
 * in exactly one place:
 *
 *   · verdict 'novel' / no match → green. Nothing was reinvented.
 *   · proof 'executed'           → we ran both functions. Only this may go red.
 *   · anything else (suspected)  → amber. The model suspects; it did not prove.
 *
 * There is no path where a 'suspected' finding is rendered as proven.
 */
import type { ClusterDetail, ClusterMember, PrFinding } from '@/types/ditto';

export type PrFindingState = 'proven' | 'suspected' | 'novel';

export function findingState(finding: PrFinding): PrFindingState {
  if (finding.verdict === 'novel' || finding.match === null) return 'novel';
  return finding.proof === 'executed' ? 'proven' : 'suspected';
}

/** True only when the code was really run AND it really disagreed. */
export function findingDiverged(finding: PrFinding): boolean {
  return (
    finding.proof === 'executed' &&
    (finding.divergence?.rows.some((row) => row.diverged) ?? false)
  );
}

/**
 * Express a finding as the `ClusterDetail` the existing divergence renderer
 * consumes, so the money-shot table is reused unchanged. Only the fields
 * `DivergenceTable` actually reads are populated — it never touches `body`, and
 * PrFinding carries no function source (§3.4), so bodies stay empty.
 *
 * The backend probes the pair with stable, explicit member ids: the existing
 * implementation is `'baseline'` and the PR's new function is `'pr'` (see the
 * ProbeService call in backend pr.service). We key the members to those exact
 * ids so `DivergenceTable` — which matches `result.functionId === member.id` —
 * lines up the output columns correctly regardless of row/result order.
 */
export function findingToCluster(finding: PrFinding, index: number): ClusterDetail {
  const proven = findingDiverged(finding);
  const bothPure = finding.proof === 'executed';

  const members: ClusterMember[] = [];

  if (finding.match) {
    members.push({
      id: 'baseline',
      name: finding.match.name,
      file: finding.match.file,
      startLine: finding.match.startLine,
      endLine: finding.match.endLine,
      body: '',
      loc: Math.max(1, finding.match.endLine - finding.match.startLine + 1),
      isPure: bothPure,
      isCanonical: true,
      origin: 'baseline',
    });
  }

  members.push({
    id: 'pr',
    name: finding.newFunction.name,
    file: finding.newFunction.file,
    startLine: finding.newFunction.startLine,
    endLine: finding.newFunction.endLine,
    body: '',
    loc: Math.max(1, finding.newFunction.endLine - finding.newFunction.startLine + 1),
    isPure: bothPure,
    isCanonical: false,
    origin: 'pr',
  });

  return {
    id: `pr-finding-${index}`,
    domain: finding.newFunction.name,
    behaviorSummary: finding.match
      ? `Reinvents ${finding.match.name}`
      : 'New behaviour introduced by this PR',
    memberCount: members.length,
    confidence: finding.confidence,
    // Only a proven, confident, semantic disagreement is allowed to scream red;
    // `isProvenConflict` (used by DivergenceTable) also requires confidence ≥
    // the claim threshold, so a low-confidence executed diff still degrades.
    disagreementRisk: proven ? 'semantic' : 'none',
    hasProvenDivergence: proven,
    linesRemovable: 0,
    members,
    differences: [],
    divergence: finding.divergence ?? undefined,
  };
}
