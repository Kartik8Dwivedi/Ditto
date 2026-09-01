'use client';

import { ChevronRight, TriangleAlert } from 'lucide-react';
import type { ClusterSummary } from '@/types/ditto';
import { cn } from '@/lib/utils';
import { verdictFor } from '@/lib/cluster-verdict';
import { useClusterDrawer } from '@/stores/cluster.store';
import { Badge } from '@/components/ui/badge';
import { ClusterDrawer } from '@/components/cluster/cluster-drawer';
import { sortByRisk } from '@/lib/mocks/derive';
import { useMemo, useState } from 'react';
import { ClusterToolbar, SortOption } from './cluster-toolbar';

function ClusterRow({ cluster, index }: { cluster: ClusterSummary; index: number }) {
  const openCluster = useClusterDrawer((s) => s.openCluster);
  const verdict = verdictFor(cluster);
  const soft = !verdict.isHardClaim;

  return (
    <button
      type="button"
      onClick={() => openCluster(cluster.id)}
      style={{ animationDelay: `${Math.min(index * 28, 340)}ms` }}
      className={cn(
        'animate-rise group flex w-full items-center gap-3 px-4 py-2.5 text-left',
        'transition-colors duration-150 hover:bg-inset',
        'not-last:border-b not-last:border-line/70',
        // A finding we are not confident about looks like a lead, not a claim.
        soft && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--inset)_6px,var(--inset)_7px)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          verdict.tone === 'danger' && 'bg-danger',
          verdict.tone === 'warn' && 'bg-warn',
          verdict.tone === 'success' && 'bg-success',
          verdict.tone === 'ai' && 'bg-ai',
          verdict.tone === 'neutral' && 'bg-ink-subtle',
        )}
      />

      <span className="w-40 shrink-0 truncate font-mono text-[13px] font-medium text-ink">
        {cluster.domain}
      </span>

      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
        {cluster.behaviorSummary}
      </span>

      <span className="tnum w-16 shrink-0 text-right font-mono text-[11px] text-ink-subtle">
        {cluster.memberCount} impls
      </span>

      <span className="tnum w-11 shrink-0 text-right font-mono text-[11px] text-ink-subtle">
        {cluster.confidence.toFixed(2)}
      </span>

      <span className="flex w-[236px] shrink-0 items-center justify-end gap-1.5">
        {/*
          No count here on purpose. PRD §4.2 asks for an "N disagree" badge, but
          ClusterSummary carries no field for how many members disagree — only
          memberCount, which would render "4 disagree" for a cluster where three
          agree and one does not. The exact count lives in the drawer, where the
          divergence rows are actually available.
        */}
        {cluster.hasProvenDivergence && (
          <Badge tone="danger" title="Executed on the same inputs — they returned different answers.">
            <TriangleAlert aria-hidden className="size-3" />
            They disagree
          </Badge>
        )}
        <Badge tone={verdict.tone} dashed={verdict.dashed}>
          {verdict.label}
        </Badge>
      </span>

      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted"
      />
    </button>
  );
}

export function ClusterList({ clusters }: { clusters: ClusterSummary[] }) {
  const [search, setSearch] = useState('');
  const [selectedVerdict, setSelectedVerdict] = useState<string>('all');
  const [provenOnly, setProvenOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('risk');

  const visibleClusters = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = clusters.filter((cluster) => {
      if (provenOnly && !cluster.hasProvenDivergence) {
        return false;
      }

      if (selectedVerdict !== 'all') {
        const verdict = verdictFor(cluster);
        if (verdict.label !== selectedVerdict) return false;
      }

      if (query.length > 0) {
        const matchDomain = cluster.domain.toLowerCase().includes(query);
        const matchSummary = cluster.behaviorSummary.toLowerCase().includes(query);
        if (!matchDomain && !matchSummary) return false;
      }
      return true;
    });

    if (sortBy === 'confidence') {
      return filtered.sort((a, b) => b.confidence - a.confidence);
    }
    if (sortBy === 'members') {
      return filtered.sort((a, b) => b.memberCount - a.memberCount);
    }
    return sortByRisk(filtered);
  }, [clusters, search, selectedVerdict, provenOnly, sortBy]);
    
  if (clusters.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-panel px-4 py-10 text-center">
        <p className="text-[13px] text-ink">No semantic duplicate clusters found.</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          Every function Ditto fingerprinted in this repo looks like it does its own job. That is a
          good result — there is nothing to consolidate.
        </p>
      </div>
    );
  }

  return (
    <>
      <ClusterToolbar
         search={search}
         onSearchChange={setSearch}
         selectedVerdict={selectedVerdict}
         onVerdictChange={setSelectedVerdict}
         provenOnly={provenOnly}
         onProvenOnlyToggle={() => setProvenOnly((prev) => !prev)}
         sortBy={sortBy}
         onSortByChange={setSortBy}
         totalCount={clusters.length}
         filteredCount={visibleClusters.length}
      />
       
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <header className="flex items-center gap-3 border-b border-line bg-inset/60 px-4 py-1.5">
          <span aria-hidden className="size-1.5 shrink-0" />
          <span className="w-40 shrink-0 font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Domain
          </span>
          <span className="min-w-0 flex-1 font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Behaviour
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Members
          </span>
          <span className="w-11 shrink-0 text-right font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Conf
          </span>
          <span className="w-[236px] shrink-0 text-right font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
            Verdict
          </span>
          <span aria-hidden className="size-3.5 shrink-0" />
        </header>

        {visibleClusters.length > 0 ? (
          visibleClusters.map((cluster, index) => (
            <ClusterRow key={cluster.id} cluster={cluster} index={index} />
          ))
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-[13px] text-ink">No duplicate clusters match your filters.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSelectedVerdict('all');
                setProvenOnly(false);
              }}
              className="mt-2 text-[12px] text-accent hover:underline"
            >
              Reset all filters
            </button>
          </div>
        )}
      </div>

      <ClusterDrawer />
    </>
  );
}
