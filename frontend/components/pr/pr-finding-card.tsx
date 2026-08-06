import { ArrowRight, CheckCircle2, FileCode2, TriangleAlert } from 'lucide-react';
import type { ClusterMember, PrFinding } from '@/types/ditto';
import { cn } from '@/lib/utils';
import { findingDiverged, findingState, findingToCluster } from '@/lib/pr-finding';
import { Badge } from '@/components/ui/badge';
import { DivergenceTable } from '@/components/cluster/divergence-table';
import { TruthBadge } from '@/components/cluster/truth-badge';

/**
 * One PR finding, rendered asymmetrically: this is the ONLY new framing the PR
 * surface needs. Everything load-bearing is reused — the proof table is the
 * existing `DivergenceTable`, the honesty badge is the existing `TruthBadge`,
 * and the new-vs-existing labelling is driven by `member.origin === 'pr'`.
 *
 * The three states come from `findingState` (the single honesty gate):
 *   novel     → green, "no reinvention found".
 *   proven    → executed; may show the red divergence table.
 *   suspected → amber; NEVER a table, NEVER the word "proven".
 */
export function PrFindingCard({ finding, index }: { finding: PrFinding; index: number }) {
  const state = findingState(finding);
  const cluster = findingToCluster(finding, index);
  const prMember = cluster.members.find((m) => m.origin === 'pr')!;
  const baseMember = cluster.members.find((m) => m.origin === 'baseline');

  if (state === 'novel') {
    return (
      <article className="animate-rise rounded-xl border border-success-line/60 bg-success-bg/10 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 aria-hidden className="size-4 text-success" />
          <h3 className="font-mono text-[14px] font-semibold text-ink">{prMember.name}</h3>
          <Badge tone="ai">New in this PR</Badge>
          <Badge tone="success">No reinvention found</Badge>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Ditto did not find an existing function this reinvents — it looks genuinely new. Nothing to
          consolidate.
        </p>
        <div className="mt-3">
          <FunctionRef member={prMember} />
        </div>
      </article>
    );
  }

  // proven | suspected — both describe a reinvention of an existing impl.
  const diverged = findingDiverged(finding);
  const usedByCount = finding.usedBy.length;

  return (
    <article
      className={cn(
        'animate-rise space-y-4 rounded-xl border p-5',
        state === 'proven'
          ? 'border-danger-line/60 bg-danger-bg/[0.08]'
          : 'border-warn-line/60 bg-warn-bg/[0.08]',
      )}
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {state === 'proven' ? (
            <TriangleAlert aria-hidden className="size-4 text-danger" />
          ) : (
            <TriangleAlert aria-hidden className="size-4 text-warn" />
          )}
          <h3 className="text-[14px] leading-snug text-ink-muted">
            This PR&rsquo;s{' '}
            <span className="font-mono font-semibold text-ink">{prMember.name}</span> reinvents{' '}
            <span className="font-mono font-semibold text-ink">{baseMember?.name}</span>
            {usedByCount > 0 && (
              <span className="text-ink-subtle">
                {' '}
                (used by {usedByCount} module{usedByCount === 1 ? '' : 's'})
              </span>
            )}
          </h3>
          {state === 'proven' ? (
            diverged ? (
              <Badge tone="danger">
                <TriangleAlert aria-hidden className="size-3" />
                Proven to disagree
              </Badge>
            ) : (
              <Badge tone="success">
                <CheckCircle2 aria-hidden className="size-3" />
                Executed — behaves identically
              </Badge>
            )
          ) : (
            <TruthBadge executed={false} />
          )}
        </div>
        <p className="tnum font-mono text-[11px] text-ink-subtle">
          similarity {finding.similarity.toFixed(2)} · confidence {finding.confidence.toFixed(2)}
        </p>
      </header>

      {/* new vs existing — badged by member.origin */}
      <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <FunctionRef member={prMember} />
        <div className="hidden items-center justify-center sm:flex">
          <ArrowRight aria-hidden className="size-4 text-ink-subtle" />
        </div>
        {baseMember && <FunctionRef member={baseMember} />}
      </div>

      {finding.usedBy.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Existing impl used by
          </span>
          {finding.usedBy.map((module) => (
            <span
              key={module}
              className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
            >
              {module}
            </span>
          ))}
        </div>
      )}

      {state === 'proven' ? (
        finding.divergence ? (
          <DivergenceTable cluster={cluster} />
        ) : (
          <p className="rounded-lg border border-line bg-panel px-4 py-3 text-[12px] text-ink-muted">
            Both functions were executed on the same inputs and returned the same answers — a clean
            duplicate to consolidate, not a behavioural conflict.
          </p>
        )
      ) : (
        <div className="rounded-lg border border-dashed border-warn-line/60 bg-warn-bg/30 px-4 py-3">
          <p className="text-[12px] leading-relaxed text-warn">
            Ditto suspects <span className="font-mono">{prMember.name}</span> reinvents{' '}
            <span className="font-mono">{baseMember?.name}</span>, but at least one side has side
            effects, so it could not be safely executed. Nothing here is proven — treat it as a lead
            to investigate, not a bug.
          </p>
        </div>
      )}
    </article>
  );
}

/** A compact function identity — name + location. No body: §3.4 carries none. */
function FunctionRef({ member }: { member: ClusterMember }) {
  const isPr = member.origin === 'pr';
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border bg-panel px-3 py-2',
        isPr ? 'border-ai-line' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2">
        <FileCode2 aria-hidden className="size-3.5 shrink-0 text-ink-subtle" />
        <span className="truncate font-mono text-[13px] font-semibold text-ink">{member.name}</span>
        {isPr ? (
          <Badge tone="ai">New in this PR</Badge>
        ) : (
          <Badge tone="neutral">Already exists</Badge>
        )}
      </div>
      <p className="truncate font-mono text-[11px] text-ink-muted">
        {member.file}
        <span className="text-ink-subtle">
          :{member.startLine}
          {member.endLine > member.startLine ? `–${member.endLine}` : ''}
        </span>
      </p>
    </div>
  );
}
