import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import type { RepoSummary } from '@/types/ditto';
import { MockDataNotice } from '@/components/ui/mock-data-notice';
import { ThemeToggle } from '@/components/ui/theme-toggle';

/**
 * Absolute, in UTC, rather than "4h ago" — a relative label computed on the
 * server drifts or freezes depending on when the page was rendered, and a
 * timestamp that quietly lies about freshness is not worth the charm.
 */
function formatIndexedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(date);
}

export function RepoHeader({ repo }: { repo: RepoSummary }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-4 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-ink transition-opacity duration-150 hover:opacity-80"
        >
          <img src="/logo/ditto_dark_bg.png" alt="Ditto Logo" className="logo-dark-theme h-5 w-auto shrink-0" />
          <img src="/logo/ditto_white_bg.png" alt="Ditto Logo" className="logo-light-theme h-5 w-auto shrink-0" />
        </Link>

        <span aria-hidden className="h-3.5 w-px bg-line-strong" />

        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13px] text-ink">
            {repo.owner}
            <span className="text-ink-subtle">/</span>
            {repo.name}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-inset px-1.5 py-px font-mono text-[10px] text-ink-muted">
            <GitBranch aria-hidden className="size-2.5" />
            {repo.commit}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <MockDataNotice />
          <span className="hidden font-mono text-[11px] text-ink-subtle sm:inline">
            indexed {formatIndexedAt(repo.indexedAt)} UTC
          </span>
          <span aria-hidden className="hidden h-3.5 w-px bg-line-strong sm:inline" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
