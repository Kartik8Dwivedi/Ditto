'use client';

import { TriangleAlert } from 'lucide-react';
import type { ClusterDetail, DivergenceRow } from '@/types/ditto';
import { cn } from '@/lib/utils';
import { isProvenConflict, rowVerdictLabel } from '@/lib/cluster-verdict';
import { TruthBadge } from './truth-badge';

/**
 * THE MONEY SHOT (PRD §4.3).
 *
 * Two rules govern every pixel in here:
 *
 * 1. A cell only screams red when we REALLY RAN the code and it REALLY
 *    disagreed. If `divergence.executed` is false these are predictions, and
 *    predictions render amber and dashed — never as proof.
 * 2. A cosmetic disagreement is amber, not red. Claiming a separator change is
 *    a latent bug would be crying wolf, and the one finding that matters is the
 *    one nobody believes after that.
 */

/** A throw is a result too, and it is still a disagreement. */
function resultKey(result: { output: string; error?: string }): string {
  return result.error ? `threw:${result.error}` : result.output;
}

/** Last path segment, to tell same-named columns apart. */
function basename(file: string): string {
  const parts = file.split('/');
  return parts[parts.length - 1] || file;
}

/**
 * Cells are judged against the canonical implementation — the question a reader
 * actually has is "which of these disagrees with the one we should keep?".
 * Falls back to the most common output if no member is marked canonical.
 */
function referenceKeyFor(row: DivergenceRow, canonicalId: string | undefined): string | undefined {
  const canonical = row.results.find((r) => r.functionId === canonicalId);
  if (canonical) return resultKey(canonical);

  const counts = new Map<string, number>();
  for (const result of row.results) {
    const key = resultKey(result);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return bestCount > 1 ? best : undefined;
}

export function DivergenceTable({ cluster }: { cluster: ClusterDetail }) {
  const { divergence, members } = cluster;
  if (!divergence || divergence.rows.length === 0) return null;

  const executed = divergence.executed;
  const canonicalId = members.find((m) => m.isCanonical)?.id;
  // Only a proven, confident, semantic disagreement is allowed to scream red.
  const hot = isProvenConflict(cluster, executed);

  const divergedCount = divergence.rows.filter((r) => r.diverged).length;

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h3 className="font-mono text-[11px] font-semibold tracking-[0.14em] text-ink uppercase">
            Behavioral Comparison
          </h3>
          <span className="tnum text-[11px] text-ink-subtle">
            {divergedCount > 0
              ? `${divergedCount} of ${divergence.rows.length} inputs disagree`
              : `${divergence.rows.length} inputs · all agree`}
          </span>
        </div>
        <TruthBadge executed={executed} />
      </header>

      {!executed && (
        <p className="border-b border-warn-line/50 bg-warn-bg/40 px-4 py-2 text-[11px] text-warn">
          These outputs were predicted by the model, not produced by running the code. Treat them as
          a lead to investigate, not as proof.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead>
            <tr className="border-b border-line">
              <th
                scope="col"
                className="px-4 py-2 text-left text-[10px] font-medium tracking-wider text-ink-subtle uppercase"
              >
                Input
              </th>
              {members.map((member) => (
                <th
                  key={member.id}
                  scope="col"
                  className="px-2.5 py-2 text-left align-bottom whitespace-nowrap"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                    {member.name}
                    {member.isCanonical && (
                      <span className="text-[9px] tracking-wider text-accent uppercase">
                        canonical
                      </span>
                    )}
                  </span>
                  {/* When several members share a name (the whole point of this
                      cluster), the file is the only thing that tells the columns
                      apart — and it matches the card above. */}
                  <span className="block text-[10px] font-normal text-ink-subtle">
                    {basename(member.file)}
                  </span>
                </th>
              ))}
              <th
                scope="col"
                className="px-4 py-2 text-right text-[10px] font-medium tracking-wider text-ink-subtle uppercase"
              >
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {divergence.rows.map((row, rowIndex) => {
              const reference = referenceKeyFor(row, canonicalId);
              return (
                <tr
                  key={rowIndex}
                  className={cn(
                    'not-last:border-b not-last:border-line/60',
                    row.diverged ? (hot ? 'bg-danger-bg/25' : 'bg-warn-bg/20') : 'hover:bg-inset/60',
                  )}
                >
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-normal whitespace-nowrap text-ink"
                  >
                    {row.input}
                  </th>

                  {members.map((member) => {
                    const result = row.results.find((r) => r.functionId === member.id);
                    if (!result) {
                      return (
                        <td key={member.id} className="px-3 py-2 text-ink-subtle">
                          —
                        </td>
                      );
                    }

                    const threw = Boolean(result.error);
                    const odd = reference !== undefined && resultKey(result) !== reference;
                    // A throw is only remarkable if the row actually disagreed:
                    // every member throwing the same error is agreement.
                    const flag = row.diverged && (odd || threw);

                    return (
                      <td key={member.id} className="px-2.5 py-2 align-middle whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-block rounded px-1.5 py-0.5',
                            flag && 'font-semibold',
                            flag &&
                              (hot
                                ? 'animate-conflict-pulse bg-danger-bg text-danger'
                                : 'border border-dashed border-warn-line bg-warn-bg text-warn'),
                            !flag && (threw ? 'text-danger' : 'text-ink-muted'),
                          )}
                        >
                          {threw ? (
                            <span className="inline-flex items-center gap-1">
                              <TriangleAlert aria-hidden className="size-3" />
                              threw: {result.error}
                            </span>
                          ) : (
                            result.output
                          )}
                        </span>
                      </td>
                    );
                  })}

                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {row.diverged ? (
                      <span
                        className={cn(
                          'text-[11px] font-semibold tracking-wider',
                          hot ? 'text-danger' : 'text-warn',
                        )}
                      >
                        {rowVerdictLabel(cluster, executed)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-success/70">✓</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
