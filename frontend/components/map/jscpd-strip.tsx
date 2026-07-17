import { Terminal } from 'lucide-react';
import type { RepoStats } from '@/types/ditto';

/**
 * The contrast beat (PRD §4.4, demo 0:15–0:35).
 *
 * The jscpd side is static, and is meant to be: it is what `npx jscpd .`
 * actually prints for this repo, and the demo runs it live alongside.
 *
 * The claim here is deliberately narrow — token-based tools return zero for
 * syntactically-different equivalents, which is definitionally true. We are not
 * claiming jscpd is bad. It is answering a different question correctly.
 */
export function JscpdStrip({ stats }: { stats: RepoStats }) {
  return (
    <section className="grid grid-cols-1 overflow-hidden rounded-lg border border-line md:grid-cols-2">
      <div className="border-b border-line bg-inset md:border-r md:border-b-0">
        <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Terminal aria-hidden className="size-3 text-ink-subtle" />
          <span className="font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Token-based · jscpd
          </span>
        </header>
        <div className="px-3 py-2.5 font-mono text-[12px] leading-relaxed">
          <p className="text-ink-subtle">
            <span className="text-success">$</span> npx jscpd .
          </p>
          <p className="mt-1 text-ink-muted">
            Clones found: <span className="text-ink">0</span>
          </p>
          <p className="text-ink-muted">
            Duplication: <span className="text-ink">0.4%</span>{' '}
            <span className="text-success">✅</span>
          </p>
        </div>
      </div>

      <div className="bg-panel">
        <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-danger" />
          <span className="font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Semantic · Ditto
          </span>
        </header>
        <div className="px-3 py-2.5 font-mono text-[12px] leading-relaxed">
          <p className="text-ink-muted">
            Semantic clusters:{' '}
            <span className="font-semibold text-danger">{stats.semanticDuplicateClusters}</span>
          </p>
          <p className="text-ink-muted">
            Proven conflicts:{' '}
            <span className="font-semibold text-danger">{stats.behavioralConflicts}</span>
          </p>
          <p className="mt-1 text-[11px] text-ink-subtle">
            Same behaviour, different tokens — so jscpd cannot see them.
          </p>
        </div>
      </div>
    </section>
  );
}
