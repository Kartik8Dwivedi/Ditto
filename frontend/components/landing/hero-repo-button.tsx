import Link from 'next/link';
import { ArrowRight, GitBranch } from 'lucide-react';
import type { RepoSummary } from '@/types/ditto';

/**
 * The one-click path. The demo always uses these — the paste box is the
 * "try to break it" path.
 */
export function HeroRepoButton({ repo, blurb }: { repo: RepoSummary; blurb: string }) {
  return (
    <Link
      href={`/repo/${repo.id}`}
      className="group flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-3 transition-colors duration-150 hover:border-line-strong hover:bg-inset"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] font-medium text-ink">
          {repo.owner}
          <span className="text-ink-subtle">/</span>
          {repo.name}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-ink-muted">{blurb}</p>
      </div>

      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-inset px-1.5 py-px font-mono text-[10px] text-ink-subtle group-hover:bg-panel">
        <GitBranch aria-hidden className="size-2.5" />
        {repo.commit}
      </span>

      <ArrowRight
        aria-hidden
        className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
      />
    </Link>
  );
}
