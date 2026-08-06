'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, GitPullRequest, LoaderCircle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { analyzePR, DittoApiError } from '@/services/ditto.api';
import { parsePullRequest } from '@/lib/github';
import { cn } from '@/lib/utils';

/**
 * Ditto Guard — the live per-PR entry point (docs/RESUME_BUILD.md §3, T2-FE).
 *
 * Mirrors RepoPicker's validate → submit → navigate scaffolding, but on the PR
 * path: parse a `github.com/owner/repo/pull/<n>` URL locally, POST /pr, then
 * either go straight to the PR results page (dedup hit) or watch the existing
 * progress stepper (which routes to /pr/:id on done).
 */
export function GuardRoadmapCard() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;

    const query = value.trim();
    if (query === '') return;

    // Client-side gate: reject anything that is not a PR URL before we ask the
    // backend, so the feedback is immediate and specific.
    const ref = parsePullRequest(query);
    if (!ref) {
      setError(
        'That does not look like a pull request. Paste a github.com/owner/repo/pull/<number> URL.',
      );
      return;
    }
    setError(null);

    try {
      const { jobId, prAnalysisId } = await analyzePR(query);
      if (prAnalysisId) {
        // Dedup hit — this head SHA was already checked. Go straight to results.
        startTransition(() => router.push(`/pr/${prAnalysisId}`));
      } else if (jobId) {
        // New check queued — watch it run, then it lands on /pr/:id.
        const slug = `${ref.owner}/${ref.name} #${ref.prNumber}`;
        startTransition(() => router.push(`/analyze/${jobId}?repo=${encodeURIComponent(slug)}`));
      } else {
        setError('The analysis service returned an unexpected response. Please try again.');
      }
    } catch (err) {
      const message =
        err instanceof DittoApiError ? err.message : 'Could not start the PR check. Please try again.';
      setError(message);
      toast.error('Could not check that pull request', { description: message });
    }
  };

  const busy = isPending;

  return (
    <div className="relative overflow-hidden rounded-xl border border-line-strong bg-panel p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent-line bg-accent-bg/40 text-accent"
        >
          <GitPullRequest className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">Ditto Guard — scan a pull request</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-success-line bg-success-bg/40 px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-success uppercase">
              Live
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Ditto checks whether each function a PR adds reinvents one you already have — and executes
            the pure ones to prove where they disagree.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <GitPullRequest
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-subtle"
          />
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="https://github.com/owner/repo/pull/123"
            aria-label="GitHub pull request URL"
            aria-invalid={error !== null}
            disabled={busy}
            className={cn(
              'h-9 w-full rounded-md border bg-canvas pr-3 pl-9 font-mono text-[13px] text-ink',
              'placeholder:text-ink-subtle',
              'transition-colors duration-150 focus:outline-none disabled:opacity-60',
              error ? 'border-danger-line focus:border-danger' : 'border-line-strong focus:border-accent',
            )}
          />
        </div>
        <button
          type="submit"
          disabled={busy || value.trim() === ''}
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3',
            'bg-accent font-mono text-[13px] font-medium text-accent-ink',
            'transition-opacity duration-150 hover:opacity-90 disabled:opacity-40',
          )}
        >
          {busy ? (
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <ArrowRight aria-hidden className="size-3.5" />
          )}
          Check PR
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="animate-fade-in mt-2 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg/40 px-3 py-2 text-[12px] leading-relaxed text-ink-muted"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-danger" />
          <span>{error}</span>
        </p>
      )}

      <div className="mt-3 border-t border-line/60 pt-3">
        <p className="font-mono text-[11px] leading-relaxed text-ink-subtle">
          <span className="text-ink-muted">≈ $0.01 (₹1) per pull request</span> — we only fingerprint
          the functions the PR adds, not the whole repo.
        </p>
      </div>
    </div>
  );
}
