'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * CSS-only tooltip. Shows on hover and on keyboard focus.
 * Hand-rolled rather than pulling in a popover library — see PRD §5.
 */
export function Tooltip({
  label,
  children,
  className,
  side = 'bottom',
  align = 'center',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
}) {
  return (
    <span className={cn('group/tip relative inline-flex', className)} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-[280px] rounded-md border border-line-strong',
          'bg-panel px-2.5 py-1.5 text-[11px] leading-snug font-normal tracking-normal normal-case',
          'text-ink-muted opacity-0 shadow-xl shadow-black/40 transition-opacity duration-150',
          'group-hover/tip:opacity-100 group-focus/tip:opacity-100',
          side === 'bottom' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'start' && 'left-0',
          align === 'end' && 'right-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
