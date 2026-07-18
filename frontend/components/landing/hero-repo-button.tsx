import Link from 'next/link';
import { ArrowRight, GitBranch, ShieldAlert, Sparkles, Database } from 'lucide-react';
import type { RankedRepo } from '@/lib/repo-ranking';
import { cn } from '@/lib/utils';

/**
 * A repo card on the landing page.
 *
 * Purely presentational: its metrics are fetched on the SERVER and passed in.
 * It used to fetch its own stats on mount, which was unreliable — the largest
 * repo's detail endpoint takes ~8s, so four parallel client fetches would lose
 * the race on any hiccup and the card fell back to "no metrics". Fetching
 * server-side also lets the list be sorted by interestingness before it renders.
 */
export function HeroRepoButton({
  repo,
  stats,
  provenDivergences,
  blurb,
}: RankedRepo & { blurb: string }) {
  const score = stats?.healthScore;
  const isHealthy = score !== undefined ? score >= 80 : true;
  const isWarning = score !== undefined ? score >= 50 && score < 80 : false;

  return (
    <Link
      href={`/repo/${repo.id}`}
      className="group block rounded-xl border border-line bg-panel p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-inset hover:shadow-lg hover:shadow-black/20"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold tracking-tight text-ink transition-colors duration-150 group-hover:text-accent">
              {repo.owner}
              <span className="text-ink-subtle">/</span>
              {repo.name}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-muted">
              <GitBranch aria-hidden className="size-2.5" />
              {repo.commit}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{blurb}</p>
        </div>

        {score !== undefined && (
          <div className="flex items-center gap-3 self-end sm:self-start">
            <div className="text-right">
              <div className="font-mono text-xs text-ink-subtle">Ditto Score</div>
              <div
                className={cn(
                  'mt-0.5 font-mono text-xl leading-none font-bold',
                  isHealthy && 'text-success',
                  isWarning && 'text-warn',
                  !isHealthy && !isWarning && 'text-danger',
                )}
              >
                {score}
                <span className="text-[10px] font-normal text-ink-subtle">/100</span>
              </div>
            </div>
            <span className="h-6 w-px bg-line-strong" />
            <div
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase',
                isHealthy && 'border-success-line bg-success-bg/20 text-success',
                isWarning && 'border-warn-line bg-warn-bg/20 text-warn',
                !isHealthy && !isWarning && 'border-danger-line bg-danger-bg/20 text-danger',
              )}
            >
              {isHealthy ? 'Healthy' : isWarning ? 'Needs Work' : 'Dupe Risk'}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2 border-t border-line/60 pt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-ink-subtle">
          {stats ? (
            <>
              <span className="flex items-center gap-1.5">
                <Database className="size-3 text-ink-subtle" />
                <strong className="font-medium text-ink-muted">
                  {stats.functions.toLocaleString('en-US')}
                </strong>{' '}
                functions
              </span>
              <span className="hidden text-line sm:inline">•</span>
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-ai" />
                <strong className="font-medium text-ink-muted">
                  {stats.semanticDuplicateClusters}
                </strong>{' '}
                clusters
              </span>
              {provenDivergences > 0 && (
                <>
                  <span className="hidden text-line sm:inline">•</span>
                  <span className="flex items-center gap-1.5 text-danger">
                    <ShieldAlert className="size-3" />
                    <strong className="font-bold">{provenDivergences}</strong> proven divergences
                  </span>
                </>
              )}
            </>
          ) : (
            // Only when the metrics genuinely could not be loaded — say so
            // plainly rather than implying the repo has nothing to show.
            <span className="text-ink-subtle">Metrics unavailable — open to view</span>
          )}
        </div>

        <div className="flex items-center gap-1 font-mono text-xs text-ink-subtle transition-colors duration-150 group-hover:text-ink">
          Open Intelligence
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform duration-150 group-hover:translate-x-1"
          />
        </div>
      </div>
    </Link>
  );
}
