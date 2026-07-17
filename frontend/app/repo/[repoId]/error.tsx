'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, TriangleAlert } from 'lucide-react';

/**
 * Next 16.2 passes `unstable_retry`, which re-fetches and re-renders the
 * segment. (`reset` still exists but only clears the error state without
 * re-fetching, which is not what we want here — the whole point is to retry the
 * request that failed.) Verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */
export default function RepoError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[ditto] repo page failed', error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 text-danger" />
          <h1 className="font-mono text-[13px] font-semibold text-ink">
            Could not load this analysis
          </h1>
        </div>

        <p className="text-[13px] leading-relaxed text-ink-muted">
          Ditto reached the page but not the data behind it. Nothing has been analysed, so there is
          nothing to show — rather than guess, here is what went wrong:
        </p>

        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-inset px-3 py-2 font-mono text-[11px] text-danger">
          {error.message || 'Unknown error'}
        </pre>

        {error.digest && (
          <p className="mt-1.5 font-mono text-[10px] text-ink-subtle">digest: {error.digest}</p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink transition-colors duration-150 hover:bg-inset"
          >
            <RotateCw aria-hidden className="size-3" />
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 font-mono text-[12px] text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            Back to repositories
          </Link>
        </div>
      </div>
    </div>
  );
}
