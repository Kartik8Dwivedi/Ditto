import { cn } from '@/lib/utils';

/** Two overlapping glyphs — the same shape, drawn twice, slightly out of step. */
export function DittoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn('shrink-0', className)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.25" y="1.25" width="9" height="9" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="5.75"
        y="5.75"
        width="9"
        height="9"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.6 2.2"
        opacity="0.75"
      />
    </svg>
  );
}
