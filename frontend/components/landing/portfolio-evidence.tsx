import type { RankedRepo } from '@/lib/repo-ranking';
import { PROVEN_LABEL, SUSPECTED_LABEL } from '@/lib/repo-metrics';

/**
 * What Ditto has actually analysed, totalled from the indexed repos.
 *
 * Every figure is summed from the same data the cards below render, so the
 * evidence line can never claim more than the cards can show. Nothing here is
 * hardcoded — analyse another repo and these move on their own.
 */
export function PortfolioEvidence({ repos }: { repos: RankedRepo[] }) {
  const withStats = repos.filter((r) => r.stats !== null);
  const total = (pick: (r: RankedRepo) => number) =>
    withStats.reduce((sum, r) => sum + pick(r), 0);

  const functions = total((r) => r.stats?.functions ?? 0);
  const clusters = total((r) => r.stats?.semanticDuplicateClusters ?? 0);
  const suspected = total((r) => r.stats?.behavioralConflicts ?? 0);
  const proven = total((r) => r.provenDivergences);

  const items = [
    { value: withStats.length.toLocaleString('en-US'), label: 'repositories analysed' },
    { value: functions.toLocaleString('en-US'), label: 'functions fingerprinted' },
    { value: clusters.toLocaleString('en-US'), label: 'semantic clusters' },
    { value: suspected.toLocaleString('en-US'), label: SUSPECTED_LABEL.toLowerCase(), tone: 'warn' as const },
    { value: proven.toLocaleString('en-US'), label: PROVEN_LABEL.toLowerCase(), tone: 'danger' as const },
  ];

  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-1.5">
            <dt className="sr-only">{item.label}</dt>
            <dd
              className={
                item.tone === 'danger'
                  ? 'tnum font-mono text-[17px] font-semibold text-danger'
                  : item.tone === 'warn'
                    ? 'tnum font-mono text-[17px] font-semibold text-warn'
                    : 'tnum font-mono text-[17px] font-semibold text-ink'
              }
            >
              {item.value}
            </dd>
            <span className="text-[12px] text-ink-muted">{item.label}</span>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        Totalled from the repositories below — suspected is the adjudicator&rsquo;s judgement,
        proven is what Ditto executed and watched disagree.
      </p>
    </div>
  );
}
