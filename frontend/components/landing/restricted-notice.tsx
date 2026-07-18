import Link from 'next/link';
import { ExternalLink, Gauge, Terminal } from 'lucide-react';
import {
  GITHUB_REPO_URL,
  isRestrictedMode,
  liveMaxFunctions,
  SUGGESTED_REPOS,
} from '@/lib/config';

/**
 * Explains the hosted demo's analysis cap — before someone pastes a repo and
 * hits it.
 *
 * The framing is deliberate: this is a documented budget guardrail, not a
 * shortcoming of the pipeline. The same pipeline analysed github/gh-aw's 2,870
 * functions offline, and that repo is sitting in the cards right below this
 * banner, so the claim is checkable rather than asserted.
 *
 * Renders nothing when restricted mode is off (i.e. running locally), because
 * there is no cap to explain.
 */
export function RestrictedNotice() {
  if (!isRestrictedMode()) return null;

  const maxFunctions = liveMaxFunctions();

  return (
    <aside className="rounded-xl border border-warn-line bg-warn-bg/30 p-4 text-left">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-lg border border-warn-line bg-warn-bg text-warn"
        >
          <Gauge className="size-3.5" />
        </span>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[11px] font-semibold tracking-[0.14em] text-warn uppercase">
              Restricted mode
            </h3>
            <span className="rounded border border-warn-line bg-warn-bg/60 px-1.5 py-px font-mono text-[10px] text-warn">
              live analysis &lt; {maxFunctions.toLocaleString('en-US')} functions
            </span>
          </div>

          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            This hosted demo caps on-demand analysis at repositories under{' '}
            <span className="font-mono text-ink">
              {maxFunctions.toLocaleString('en-US')}
            </span>{' '}
            functions to conserve OpenAI API credits.{' '}
            <span className="text-ink">
              That is a credits budget, not a product limit
            </span>{' '}
            — the same pipeline analysed{' '}
            <Link
              href="#indexed-repos"
              className="font-mono text-ink underline decoration-warn-line underline-offset-2 hover:text-warn"
            >
              github/gh-aw&rsquo;s 2,870 functions
            </Link>{' '}
            offline, and you can check that number on the cards below.
          </p>

          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Run it unrestricted on your own machine or your own key —{' '}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
            >
              source and setup on GitHub
              <ExternalLink aria-hidden className="size-3" />
            </a>
            .
          </p>

          <SuggestedRepos />

          <p className="text-[12px] leading-relaxed text-ink-subtle">
            Clean libraries correctly return zero clusters — that&rsquo;s Ditto not crying wolf,
            and it&rsquo;s worth seeing too.
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * Ready-to-paste repos known to sit under the cap.
 *
 * Hidden entirely while `SUGGESTED_REPOS` is the empty placeholder — showing an
 * unverified suggestion that turns out to be over the cap would walk a judge
 * into the exact failure this banner exists to prevent.
 */
function SuggestedRepos() {
  if (SUGGESTED_REPOS.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-1">
      <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
        <Terminal aria-hidden className="size-3" />
        Try one of these
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {SUGGESTED_REPOS.map((repo) => (
          <li key={repo.url}>
            <span
              title={repo.url}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2 py-1 font-mono text-[11px] text-ink"
            >
              {repo.slug}
              {repo.note && <span className="text-ink-subtle">· {repo.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
