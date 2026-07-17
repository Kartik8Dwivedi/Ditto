import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Every tone maps to one meaning, repo-wide. See app/globals.css.
 *   danger  🔴 proven semantic conflict
 *   warn    🟡 near-duplicate / predicted-not-executed
 *   success 🟢 healthy / really executed
 *   ai      🤖 suspected AI-reinvented
 *   neutral    no judgement
 */
export type BadgeTone = 'danger' | 'warn' | 'success' | 'ai' | 'accent' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  danger: 'bg-danger-bg text-danger border-danger-line',
  warn: 'bg-warn-bg text-warn border-warn-line',
  success: 'bg-success-bg text-success border-success-line',
  ai: 'bg-ai-bg text-ai border-ai-line',
  accent: 'bg-accent-bg text-accent border-accent-line',
  neutral: 'bg-inset text-ink-muted border-line-strong',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
  dashed,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
  dashed?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px',
        'font-mono text-[10px] leading-4 font-medium tracking-wider uppercase',
        dashed && 'border-dashed',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
