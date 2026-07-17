import { CircleAlert } from 'lucide-react';
import type { RepoStats } from '@/types/ditto';
import { ANALYSIS_FUNCTION_CAP } from '@/lib/constants';

/**
 * This repo hit the analysis cap. Say so, prominently.
 * Never silently truncate — see PRD §4.4.
 */
export function TruncationNotice({ stats }: { stats: RepoStats }) {
  return (
    <aside className="flex items-start gap-2.5 rounded-lg border border-warn-line bg-warn-bg/50 px-4 py-2.5">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" />
      <p className="text-[12px] leading-relaxed text-ink-muted">
        <span className="font-medium text-warn">Partial analysis.</span> This repository is larger
        than Ditto&rsquo;s per-run cap, so these findings cover the first{' '}
        <span className="tnum font-mono text-ink">
          {ANALYSIS_FUNCTION_CAP.toLocaleString('en-US')}
        </span>{' '}
        functions of{' '}
        <span className="tnum font-mono text-ink">{stats.functions.toLocaleString('en-US')}</span>{' '}
        only. There may be duplicates in the part we have not read.
      </p>
    </aside>
  );
}
