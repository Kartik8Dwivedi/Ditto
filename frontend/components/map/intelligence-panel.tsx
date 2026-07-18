import type { ReactNode } from 'react';
import { Scissors, Sparkles, TriangleAlert, ShieldAlert } from 'lucide-react';
import type { ClusterSummary, RepoStats } from '@/types/ditto';
import {
  countProvenDivergences,
  countSuspectedConflicts,
  PROVEN_LABEL,
  SUSPECTED_LABEL,
} from '@/lib/repo-metrics';
import { cn } from '@/lib/utils';
import { CountUp } from './count-up';

type Tone = 'danger' | 'warn' | 'success' | 'ai';

const DOT: Record<Tone, string> = {
  danger: 'bg-danger',
  warn: 'bg-warn',
  success: 'bg-success',
  ai: 'bg-ai',
};

const TEXT: Record<Tone, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  success: 'text-success',
  ai: 'text-ai',
};

function StatRow({
  tone,
  value,
  label,
  delayMs,
  icon,
}: {
  tone: Tone;
  value: number;
  label: string;
  delayMs: number;
  icon?: ReactNode;
}) {
  return (
    <div className="group flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded bg-inset border border-line-strong text-ink-subtle">
          {icon ?? <span className={cn('size-1.5 rounded-full', DOT[tone])} />}
        </span>
        <span className="text-[12.5px] text-ink-muted truncate group-hover:text-ink transition-colors duration-150">
          {label}
        </span>
      </div>
      <CountUp
        value={value}
        delayMs={delayMs}
        className={cn('font-mono text-[14px] font-semibold pl-3 tracking-tight tabular-nums', TEXT[tone])}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
      <h3 className="mb-3 font-mono text-[10px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
        {title}
      </h3>
      <div className="divide-y divide-line/30 space-y-1">
        {children}
      </div>
    </section>
  );
}

export function IntelligencePanel({
  stats,
  clusters,
}: {
  stats: RepoStats;
  clusters: ClusterSummary[];
}) {
  // Two different claims, deliberately shown side by side. `suspected` is the
  // adjudicator flagging semantic risk; `proven` is what Ditto actually
  // executed and watched disagree — the number you get by counting the
  // "they disagree" rows in the cluster list.
  const suspected = countSuspectedConflicts(stats);
  const proven = countProvenDivergences(clusters);

  return (
    <div className="space-y-4">
      <Group title="Code Intelligence">
        <StatRow
          tone="danger"
          value={stats.semanticDuplicateClusters}
          label="Semantic Duplicate Clusters"
          delayMs={0}
        />
        <StatRow
          tone="warn"
          value={suspected}
          label={SUSPECTED_LABEL}
          delayMs={60}
          icon={<ShieldAlert className="size-3 text-warn" />}
        />
        <StatRow
          tone="danger"
          value={proven}
          label={PROVEN_LABEL}
          delayMs={90}
          icon={<TriangleAlert className="size-3 text-danger" />}
        />
        <StatRow
          tone="warn"
          value={stats.nearDuplicates}
          label="Near-Duplicate Implementations"
          delayMs={120}
        />
        <StatRow
          tone="success"
          value={stats.reusableUtilities}
          label="Reusable Utilities Identified"
          delayMs={180}
        />
      </Group>

      <Group title="AI Risk">
        {/*
          The old "High-Risk Conflicting Impls" row lived here and counted the
          same executed clusters as "Proven by Execution" above. Two rows for
          one number, in two different groups, invited exactly the confusion
          this fix is about — so it is stated once, next to its counterpart.
        */}
        <StatRow
          tone="ai"
          value={stats.suspectedReinvented}
          label="Suspected Reinvented Utilities"
          delayMs={240}
          icon={<Sparkles className="size-3 text-ai" />}
        />
      </Group>

      <Group title="Estimated Consolidation">
        <div className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-center gap-3 min-w-0">
            <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded bg-inset border border-line-strong text-ink-subtle">
              <Scissors className="size-3 text-ink-subtle" />
            </span>
            <span className="text-[12.5px] text-ink-muted truncate">Lines Removable</span>
          </div>
          <span className="font-mono text-[14px] font-semibold text-ink pl-3">
            ~<CountUp value={stats.linesRemovable} delayMs={360} />
          </span>
        </div>
        
        <div className="flex items-center justify-between py-2.5 border-t border-line/30">
          <div className="flex items-center gap-3 min-w-0">
            <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded bg-inset border border-line-strong text-ink-subtle">
              <span className="size-1.5 rounded-full bg-ink-subtle" />
            </span>
            <span className="text-[12.5px] text-ink-muted truncate">Unifiable Call Sites</span>
          </div>
          <span className="font-mono text-[14px] font-semibold text-ink pl-3">
            <CountUp value={stats.callSitesUnifiable} delayMs={420} />
          </span>
        </div>
      </Group>
    </div>
  );
}
