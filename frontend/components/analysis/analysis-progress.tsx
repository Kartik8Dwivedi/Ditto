'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import type { Job } from '@/types/ditto';
import { getJob } from '@/services/ditto.api';
import { PipelineProgress } from '@/components/map/pipeline-progress';

const POLL_MS = 2000;
/** Tolerate a few transient poll failures before giving up — the worker may be
 *  mid-restart or the network may blip. Beyond this we surface a real error. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Drives the on-demand analysis view (docs/ONDEMAND.md):
 * poll GET /jobs/:id every 2s → light up the pipeline stepper from `job.stage`
 * → navigate to the map on done → show the error cleanly on failure.
 */
export function AnalysisProgress({ jobId, repoSlug }: { jobId: string; repoSlug?: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = () => {
      timer = setTimeout(poll, POLL_MS);
    };

    const poll = async () => {
      try {
        const next = await getJob(jobId);
        if (cancelled) return;
        failuresRef.current = 0;
        setJob(next);

        if (next.status === 'done' && next.repoId) {
          // replace() so the back button skips the progress screen.
          router.replace(`/repo/${next.repoId}`);
          return;
        }
        if (next.status === 'failed') {
          return; // render the failed state from `job.error`; stop polling.
        }
        scheduleNext();
      } catch (err) {
        if (cancelled) return;
        failuresRef.current += 1;
        if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          setFatalError(
            err instanceof Error ? err.message : 'Lost contact with the analysis service.',
          );
          return;
        }
        scheduleNext();
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router]);

  const failed = fatalError !== null || job?.status === 'failed';
  if (failed) {
    return (
      <AnalysisFailed message={fatalError ?? job?.error ?? 'The analysis could not be completed.'} />
    );
  }

  // Once the index has run we know the function counts — surface them honestly,
  // including the live cap when it bites.
  const subtitle = jobSubtitle(job, repoSlug);

  return <PipelineProgress stageId={job?.stage ?? 'queued'} subtitle={subtitle} />;
}

function jobSubtitle(job: Job | null, repoSlug?: string): string {
  if (job?.functionsTotal != null) {
    const analysed = job.functionsAnalyzed ?? job.functionsTotal;
    const capped = analysed < job.functionsTotal;
    const counts = capped
      ? `analysing ${analysed.toLocaleString('en-US')} of ${job.functionsTotal.toLocaleString('en-US')} functions (live cap)`
      : `${job.functionsTotal.toLocaleString('en-US')} functions found`;
    return repoSlug ? `${repoSlug} · ${counts}` : counts;
  }
  if (repoSlug) return job?.stage === 'queued' || job == null ? `${repoSlug} · queued…` : repoSlug;
  return job?.stage === 'queued' || job == null ? 'Queued…' : ' ';
}

function AnalysisFailed({ message }: { message: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 text-danger" />
          <h1 className="font-mono text-[13px] font-semibold text-ink">Analysis failed</h1>
        </div>
        <p className="rounded-lg border border-danger-line bg-danger-bg/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
          {message}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink transition-colors duration-150 hover:bg-inset"
          >
            <ArrowLeft aria-hidden className="size-3" />
            Try another repo
          </Link>
          <span className="text-[11px] text-ink-subtle">or explore the pre-analysed repositories</span>
        </div>
      </div>
    </div>
  );
}
