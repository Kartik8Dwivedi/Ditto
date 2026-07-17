'use client';

import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { PIPELINE_STAGES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { DittoMark } from '@/components/ui/ditto-mark';

const STEP_MS = 420;

/**
 * The pipeline stages, made visible while the analysis loads.
 *
 * These are the real stages the backend runs, in the real order — this is a
 * progress indicator, not a fake loading bar, and it stops advancing at the
 * last stage rather than pretending to finish. Whatever it is showing when the
 * data arrives, the page swaps in; it never claims a stage completed that we
 * have no way of knowing completed.
 */
export function PipelineProgress() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const timer = setInterval(() => {
      setActive((n) => Math.min(n + 1, PIPELINE_STAGES.length - 1));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2">
          <DittoMark className="size-4 animate-pulse text-accent" />
          <h1 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink uppercase">
            Analysing repository
          </h1>
        </div>

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
