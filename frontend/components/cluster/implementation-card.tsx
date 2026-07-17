import type { ClusterMember } from '@/types/ditto';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';

/**
 * One implementation, side by side with its siblings. The whole point is that
 * these look obviously, visibly different — so the code gets the space and the
 * chrome stays out of the way.
 */
export function ImplementationCard({
  member,
  className,
}: {
  member: ClusterMember;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-panel',
        member.isCanonical ? 'border-accent-line' : 'border-line',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate font-mono text-[13px] font-semibold text-ink">{member.name}</h4>
          {member.isCanonical && <Badge tone="accent">Canonical</Badge>}
          {member.isPure && (
            <Badge
              tone="success"
              title="No side effects — safe for Ditto to execute against real inputs."
            >
              Pure
            </Badge>
          )}
          {!member.isPure && (
            <Badge tone="neutral" title="Has side effects — Ditto will not execute it.">
              Impure
            </Badge>
          )}
        </div>
        <span className="tnum shrink-0 font-mono text-[11px] text-ink-subtle">{member.loc} loc</span>
      </header>

      <p className="border-b border-line/70 px-3 py-1.5 font-mono text-[11px] text-ink-muted">
        {member.file}
        <span className="text-ink-subtle">:{member.startLine}</span>
      </p>

      <CodeBlock code={member.body} startLine={member.startLine} className="flex-1" />
    </article>
  );
}
