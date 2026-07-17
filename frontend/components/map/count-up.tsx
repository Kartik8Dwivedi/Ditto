'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const DURATION_MS = 600;

/**
 * Counts a number up on mount. It is cheap, and it reads as "analysing" —
 * but it is a moment, not a gimmick, so it is over in ~600ms and never repeats.
 * Honours prefers-reduced-motion by simply showing the number.
 */
export function CountUp({
  value,
  className,
  delayMs = 0,
}: {
  value: number;
  className?: string;
  delayMs?: number;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // Reduced motion runs the same loop with a zero duration, so it lands on
    // the final value on the first frame. Keeping one code path also keeps
    // every setState inside the rAF callback rather than the effect body.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : DURATION_MS;
    const delay = reduced ? 0 : delayMs;

    let raf = 0;
    let start: number | undefined;

    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = duration === 0 ? 1 : Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delayMs]);

  return (
    <span className={cn('tnum', className)}>{display.toLocaleString('en-US')}</span>
  );
}
