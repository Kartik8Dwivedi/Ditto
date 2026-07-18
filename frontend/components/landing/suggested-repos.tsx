'use client';

import { CircleCheck, Search } from 'lucide-react';
import { SUGGESTED_REPO_GROUPS } from '@/lib/config';
import { PASTE_BOX_INPUT_ID, usePasteBox } from '@/stores/paste-box.store';

/**
 * Verified repos a judge can try, in two labelled groups.
 *
 * The grouping is the point: a clean library returning zero clusters is a
 * CORRECT result, and saying so up front stops an empty map being read as the
 * tool failing. Every count was measured, not estimated.
 *
 * Clicking fills the analyse box and focuses it — it does NOT submit, because
 * submitting starts a real analysis that spends credits. That stays a
 * deliberate second click.
 */
export function SuggestedRepos() {
  const setValue = usePasteBox((s) => s.setValue);

  if (SUGGESTED_REPO_GROUPS.length === 0) return null;

  const fill = (url: string) => {
    setValue(url);
    document.getElementById(PASTE_BOX_INPUT_ID)?.focus();
  };

  return (
    <div className="space-y-3 pt-1">
      {SUGGESTED_REPO_GROUPS.map((group, index) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
              {index === 0 ? (
                <Search aria-hidden className="size-3" />
              ) : (
                <CircleCheck aria-hidden className="size-3 text-success" />
              )}
              {group.label}
            </p>
            <span className="text-[11px] text-ink-subtle">{group.hint}</span>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            {group.repos.map((repo) => (
              <li key={repo.url}>
                <button
                  type="button"
                  onClick={() => fill(repo.url)}
                  title={`Fill the analyse box with ${repo.url}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2 py-1 font-mono text-[11px] text-ink transition-colors duration-150 hover:border-accent-line hover:bg-inset"
                >
                  {repo.slug}
                  <span className="text-ink-subtle">
                    · {repo.functions.toLocaleString('en-US')} fns
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
