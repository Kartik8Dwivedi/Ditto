import { cn } from '@/lib/utils';
import { CountUp } from './count-up';

function band(score: number) {
  if (score >= 80) return { text: 'text-success', bar: 'bg-success', note: 'Healthy' };
  if (score >= 50) return { text: 'text-warn', bar: 'bg-warn', note: 'Needs consolidation' };
  return { text: 'text-danger', bar: 'bg-danger', note: 'High duplication risk' };
}

export function DittoScore({ score }: { score: number }) {
  const tone = band(score);

  return (
    <section className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
          Ditto Score
        </h3>
        <span className="text-[11px] text-ink-subtle">{tone.note}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <CountUp
          value={score}
          delayMs={480}
          className={cn('font-mono text-[30px] leading-none font-semibold', tone.text)}
        />
        <span className="font-mono text-[13px] text-ink-subtle">/100</span>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-inset ring-1 ring-line-strong ring-inset">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tone.bar)}
          style={{ width: `${score}%` }}
        />
      </div>
    </section>
  );
}
