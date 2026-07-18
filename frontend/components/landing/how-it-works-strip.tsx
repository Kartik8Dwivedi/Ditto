import { PIPELINE_STAGES } from '@/lib/constants';

/**
 * What Ditto does, in one line and six steps.
 *
 * The steps are read from PIPELINE_STAGES — the same list that drives the live
 * analysis stepper — so this can never drift from what the pipeline actually
 * runs. `fetch` is omitted: downloading the tarball is plumbing, not analysis.
 */
export function HowItWorksStrip() {
  const steps = PIPELINE_STAGES.filter((stage) => stage.id !== 'fetch');

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-ink">
        Ditto finds functions that do the{' '}
        <span className="font-semibold">same thing written completely differently</span>, then
        executes them on the same inputs to prove whether they disagree.
      </p>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((stage, index) => (
          <li
            key={stage.id}
            className="flex items-start gap-2.5 rounded-lg border border-line bg-panel px-3 py-2.5"
          >
            <span
              aria-hidden
              className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded border border-line-strong bg-inset font-mono text-[10px] font-semibold text-ink-subtle"
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[12px] text-ink">{stage.label}</span>
              <span className="block text-[11px] leading-relaxed text-ink-subtle">
                {stage.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
