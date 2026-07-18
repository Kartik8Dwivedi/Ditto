'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { analyzeRepo, DittoApiError } from '@/services/ditto.api';
import { parseGitHubRepo } from '@/lib/github';
import { cn } from '@/lib/utils';

/**
 * The paste path — on-demand analysis (docs/ONDEMAND.md).
 *
 * Validate the URL locally for instant feedback, then POST /analyze. The backend
 * either dedups (returns a repoId → straight to the map) or queues a job
 * (returns a jobId → the live progress view). The hero buttons below remain the
 * instant, primary path; this box is the "bring your own repo" path.
 */
export function RepoPicker() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;

    const query = value.trim();
    if (query === '') return;

    // Client-side gate: reject anything that is not a GitHub repo before we ask
    // the backend, so the feedback is immediate and specific.
    const ref = parseGitHubRepo(query);
    if (!ref) {
      setError(
        'That does not look like a public GitHub repository. Paste a github.com URL or owner/name.',
      );
      return;
    }
    setError(null);

    try {
      const { jobId, repoId } = await analyzeRepo(query);
      if (repoId) {
        // Dedup hit — already analysed. Go straight to the map.
        startTransition(() => router.push(`/repo/${repoId}`));
      } else if (jobId) {
        // New analysis queued — watch it run.
        const slug = `${ref.owner}/${ref.name}`;
        startTransition(() =>
          router.push(`/analyze/${jobId}?repo=${encodeURIComponent(slug)}`),
        );
      } else {
        setError('The analysis service returned an unexpected response. Please try again.');
      }
    } catch (err) {
      const message =
        err instanceof DittoApiError
          ? err.message
          : 'Could not start the analysis. Please try again.';
      setError(message);
      toast.error('Could not analyse that repo', { description: message });
    }
  };

  const busy = isPending;

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search
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
            placeholder="Paste a public GitHub repo — https://github.com/owner/name"
            aria-label="GitHub repository URL"
            aria-invalid={error !== null}
            disabled={busy}
            className={cn(
              'h-9 w-full rounded-md border bg-panel pr-3 pl-9 font-mono text-[13px] text-ink',
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
          Analyse
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
    </div>
  );
}
