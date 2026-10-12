import { CONFIDENCE_CLAIM_THRESHOLD } from '@/types/ditto';
import { cn } from '@/lib/utils';

/**
 * Confidence that the members really are the same thing.
 *
 * The confidence threshold bar is drawn on the meter itself, so a reader can see
 * for themselves which side of it a finding sits on rather than taking our word
 * for it. The threshold is passed in so it reflects what the backend actually used.
 */
export function ConfidenceMeter({
  confidence,
  threshold = CONFIDENCE_CLAIM_THRESHOLD,
  className,
}: {
  confidence: number;
  threshold?: number;
  className?: string;
}) {
  const pct = Math.round(confidence * 100);
  const thresholdPct = Math.round(threshold * 100);
  const meets = confidence >= threshold;

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="text-[10px] tracking-wider text-ink-subtle uppercase">Confidence</span>
      <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-inset ring-1 ring-line-strong ring-inset">
        <div
          role="progressbar"
          aria-label="Match confidence"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            meets ? 'bg-accent' : 'bg-ink-subtle',
          )}
          style={{ width: `${pct}%` }}
        />
        {/* the claim threshold */}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink/50"
          style={{ left: `${thresholdPct}%` }}
        />
      </div>
      <span className={cn('tnum font-mono text-[11px]', meets ? 'text-ink' : 'text-ink-muted')}>
        {confidence.toFixed(2)}
      </span>
      {!meets && (
        <span className="text-[11px] text-ink-subtle">
          below the {threshold.toFixed(2)} bar — reported as a lead
        </span>
      )}
    </div>
  );
}
