import { GitPullRequest, Lock } from 'lucide-react';

/**
 * Ditto Guard — roadmap, not shipped.
 *
 * Rendered as a deliberately inert block: no link, no button, `aria-disabled`,
 * dimmed, with a COMING SOON pill. Nothing here is clickable, so it cannot be
 * mistaken for a feature that is broken rather than one that is planned.
 */
export function GuardRoadmapCard() {
  return (
    <div
      aria-disabled="true"
      className="relative overflow-hidden rounded-xl border border-dashed border-line-strong bg-panel/50 p-5 opacity-75"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-inset text-ink-subtle"
          >
            <GitPullRequest className="size-4" />
          </span>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink-muted">
                Ditto Guard — scan open pull requests
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-inset px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-ink-subtle uppercase">
                <Lock aria-hidden className="size-2.5" />
                Coming soon
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Ditto checks whether each PR reinvents a function you already have, and comments
              before it merges.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-line/60 pt-3">
        <p className="font-mono text-[11px] leading-relaxed text-ink-subtle">
          <span className="text-ink-muted">≈ $0.01 (₹1) per pull request</span> — we only
          fingerprint the functions the PR adds, not the whole repo.
        </p>
      </div>
    </div>
  );
}
