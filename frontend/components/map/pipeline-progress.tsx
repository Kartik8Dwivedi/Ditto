'use client';

import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { JobStage } from '@/types/ditto';
import { PIPELINE_STAGES, stageIndex } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { DittoMark } from '@/components/ui/ditto-mark';

const STEP_MS = 420;

/**
 * The pipeline stages, made visible while an analysis runs.
 *
 * These are the real stages the backend runs, in the real order — a progress
 * indicator, not a fake loading bar. Two modes:
 *
 *  - Controlled (`stageId` given): the active row is driven by a job's live
 *    `stage`, so the stepper only advances when the backend actually does.
 *  - Uncontrolled (no `stageId`): a gentle timer walks the stages and stops at
 *    the last one. Used by the route-level loading fallback, where we have no
 *    job to read — it never claims a stage completed, it just shows life.
 */
export function PipelineProgress({
  stageId,
  subtitle,
}: {
  stageId?: JobStage | null;
  subtitle?: string;
}) {
  const controlled = stageId !== undefined;

  const [timed, setTimed] = useState(0);
  useEffect(() => {
    if (controlled) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const timer = setInterval(() => {
      setTimed((n) => Math.min(n + 1, PIPELINE_STAGES.length - 1));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [controlled]);

  // In controlled mode the active row comes from the job stage; an unrecognised
  // stage falls back to "queued" (nothing running yet) rather than guessing.
  const active = controlled ? (stageIndex(stageId) ?? -1) : timed;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-1 flex items-center gap-2">
          <DittoMark className="size-4 animate-pulse text-accent" />
          <h1 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink uppercase">
            Analysing repository
          </h1>
        </div>
        <p className="mb-5 h-4 font-mono text-[11px] text-ink-subtle">
          {subtitle ?? (active < 0 ? 'Queued…' : ' ')}
        </p>

        <ol className="space-y-0.5">
          {PIPELINE_STAGES.map((stage, index) => {
            const done = index < active;
            const running = index === active;
            return (
              <li
                key={stage.id}
                className={cn(
                  'flex items-start gap-3 rounded px-2 py-1.5 transition-colors duration-200',
                  running && 'bg-inset',
                )}
              >
                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                  {done ? (
                    <Check className="size-3 text-success" />
                  ) : running ? (
                    <LoaderCircle className="size-3 animate-spin text-accent" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-line-strong" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block font-mono text-[12px]',
                      done && 'text-ink-muted',
                      running && 'text-ink',
                      !done && !running && 'text-ink-subtle',
                    )}
                  >
                    {stage.label}
                  </span>
                  {running && (
                    <span className="animate-fade-in block text-[11px] text-ink-subtle">
                      {stage.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
