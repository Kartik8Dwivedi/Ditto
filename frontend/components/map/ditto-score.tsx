import { cn } from '@/lib/utils';
import { CountUp } from './count-up';

function band(score: number) {
  if (score >= 80) return { text: 'text-success', bar: 'bg-success', note: 'Healthy' };
  if (score >= 50) return { text: 'text-warn', bar: 'bg-warn', note: 'Needs Consolidation' };
  return { text: 'text-danger', bar: 'bg-danger', note: 'High Duplication Risk' };
}

export function DittoScore({ score }: { score: number }) {
  const tone = band(score);

  return (
    <section className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-panel to-inset p-5 shadow-sm">
      {/* Background ambient glow matching the rating tone */}
      <div className={cn(
        "absolute -right-8 -bottom-8 -z-10 h-24 w-24 rounded-full opacity-[0.06] blur-[24px] pointer-events-none",
        score >= 80 && "bg-success",
        score >= 50 && score < 80 && "bg-warn",
        score < 50 && "bg-danger"
      )} />

      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-semibold tracking-[0.18em] text-ink-subtle uppercase">
          Ditto Score
        </h3>
        <div className={cn(
          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border",
          score >= 80 && "bg-success-bg/25 border-success-line text-success",
          score >= 50 && score < 80 && "bg-warn-bg/25 border-warn-line text-warn",
          score < 50 && "bg-danger-bg/25 border-danger-line text-danger"
        )}>
          {tone.note}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <CountUp
          value={score}
          delayMs={480}
          className={cn('font-mono text-3xl font-extrabold leading-none tracking-tight', tone.text)}
        />
        <span className="font-mono text-xs text-ink-subtle">/100</span>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-inset ring-1 ring-line-strong ring-inset">
        <div
          className={cn('h-full rounded-full transition-[width] duration-[1000ms] ease-out shadow-sm', tone.bar)}
          style={{ width: `${score}%` }}
        />
      </div>
    </section>
  );
}
