import { Database } from 'lucide-react';
import type { RepoSummary } from '@/types/ditto';
import { isRestrictedMode } from '@/lib/config';

/**
 * Says plainly that this map is a stored result, not a run that just happened.
 *
 * Only shown on the hosted demo (restricted mode), because that is the only
 * place re-analysis is actually disabled — locally you can re-run it, so
 * claiming otherwise would be false.
 */
function formatIndexedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function CachedAnalysisNote({ repo }: { repo: RepoSummary }) {
  if (!isRestrictedMode()) return null;

  return (
    <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-subtle">
      <Database aria-hidden className="mt-px size-3 shrink-0" />
      <span>
        Cached analysis from{' '}
        <span className="font-mono text-ink-muted">{formatIndexedAt(repo.indexedAt)}</span> ·
        re-analysis is disabled on the hosted demo to conserve credits — run locally to
        re-analyse.
      </span>
    </p>
  );
}
