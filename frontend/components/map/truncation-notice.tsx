import { CircleAlert } from 'lucide-react';
import type { RepoStats } from '@/types/ditto';

/**
 * The honest truncation signal (docs/ONDEMAND.md), fully data-driven.
 *
 * Shows ONLY when the live pipeline analysed fewer functions than the index
 * found — `functionsAnalyzed < functionsTotal`. For a fully-analysed repo (e.g.
 * cline, where the two are equal) it renders nothing. Never a hardcoded cap:
 * the numbers come straight from the backend.
 */
export function TruncationNotice({ stats }: { stats: RepoStats }) {
  if (stats.functionsAnalyzed >= stats.functionsTotal) return null;

  return (
    <aside className="flex items-start gap-2.5 rounded-lg border border-warn-line bg-warn-bg/50 px-4 py-2.5">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" />
      <p className="text-[12px] leading-relaxed text-ink-muted">
        <span className="font-medium text-warn">Partial analysis.</span> Analysed the first{' '}
        <span className="tnum font-mono text-ink">
          {stats.functionsAnalyzed.toLocaleString('en-US')}
        </span>{' '}
        of{' '}
        <span className="tnum font-mono text-ink">
          {stats.functionsTotal.toLocaleString('en-US')}
        </span>{' '}
        functions (live demo cap). There may be duplicates in the part we have not read.
      </p>
    </aside>
  );
}
