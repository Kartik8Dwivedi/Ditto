'use client';

import { useEffect, useState } from 'react';
import { Scissors, TriangleAlert, X } from 'lucide-react';
import type { ClusterDetail } from '@/types/ditto';
import { cn } from '@/lib/utils';
import { verdictFor } from '@/lib/cluster-verdict';
import { fetchCluster } from '@/services/ditto.api';
import { useClusterDrawer } from '@/stores/cluster.store';
import { Badge } from '@/components/ui/badge';
import { ConfidenceMeter } from './confidence-meter';
import { DivergenceTable } from './divergence-table';
import { ImplementationCard } from './implementation-card';

export function ClusterDrawer() {
  const clusterId = useClusterDrawer((s) => s.openClusterId);
  const close = useClusterDrawer((s) => s.closeCluster);

  useEffect(() => {
    if (!clusterId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [clusterId, close]);

  if (!clusterId) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close cluster detail"
        onClick={close}
        className="animate-fade-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Cluster detail"
        className={cn(
          // Wide enough that a ~80-char implementation line fits in a
          // two-column grid at 1440px without clipping mid-token.
          'animate-drawer-in relative flex h-full w-[min(1240px,95vw)] flex-col',
          'border-l border-line-strong bg-canvas shadow-2xl shadow-black/50',
        )}
      >
        {/* Keyed on the cluster id so switching clusters remounts and the
            fetch state resets on its own, rather than being reset by hand. */}
        <ClusterDrawerContent key={clusterId} clusterId={clusterId} onClose={close} />
      </aside>
    </div>
  );
}

function ClusterDrawerContent({
  clusterId,
  onClose,
}: {
  clusterId: string;
  onClose: () => void;
}) {
  const [cluster, setCluster] = useState<ClusterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Goes through the real contract endpoint (GET /clusters/:id), so nothing
  // here changes when the backend lands.
  useEffect(() => {
    let cancelled = false;

    fetchCluster(clusterId)
      .then((data) => {
        if (!cancelled) setCluster(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load this cluster.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  if (error) {
    return (
      <DrawerMessage onClose={onClose}>
        <TriangleAlert className="size-5 text-danger" />
        <p className="text-ink">{error}</p>
      </DrawerMessage>
    );
  }
  if (!cluster) return <DrawerSkeleton onClose={onClose} />;
  return <ClusterBody cluster={cluster} onClose={onClose} />;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:bg-inset hover:text-ink"
    >
      <X className="size-4" />
    </button>
  );
}

function ClusterBody({ cluster, onClose }: { cluster: ClusterDetail; onClose: () => void }) {
  const verdict = verdictFor(cluster);

  return (
    <>
      <header className="shrink-0 border-b border-line px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[17px] font-semibold tracking-tight text-ink">
                {cluster.domain}
              </h2>
              <Badge tone={verdict.tone} dashed={verdict.dashed}>
                {verdict.label}
              </Badge>
              {cluster.hasProvenDivergence && (
                <Badge tone="danger">
                  <TriangleAlert aria-hidden className="size-3" />
                  Proven divergence
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">{cluster.behaviorSummary}</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <ConfidenceMeter confidence={cluster.confidence} />
          <span className="text-[11px] text-ink-subtle">
            <span className="tnum font-mono text-ink-muted">{cluster.memberCount}</span>{' '}
            implementations
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <Scissors aria-hidden className="size-3" />
            <span className="tnum font-mono text-ink-muted">~{cluster.linesRemovable}</span> lines
            removable
          </span>
        </div>

        {!verdict.isHardClaim && (
          <p className="mt-3 rounded border border-dashed border-line-strong bg-inset px-3 py-2 text-[11px] text-ink-muted">
            {verdict.blurb}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <section>
          <SectionTitle>Implementations</SectionTitle>
          <div
            className={cn(
              'grid gap-3',
              cluster.members.length > 1 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1',
            )}
          >
            {cluster.members.map((member) => (
              <ImplementationCard key={member.id} member={member} />
            ))}
          </div>
        </section>

        {cluster.divergence ? (
          <DivergenceTable cluster={cluster} />
        ) : (
          <section className="rounded-lg border border-dashed border-line-strong bg-panel px-4 py-3">
            <SectionTitle>Behavioral comparison</SectionTitle>
            <p className="text-[12px] text-ink-muted">
              Ditto did not probe this cluster, so there is nothing to prove either way. No
              divergence has been claimed.
            </p>
          </section>
        )}

        {cluster.differences.length > 0 && (
          <section className="rounded-lg border border-line bg-panel px-4 py-3">
            <SectionTitle>What differs</SectionTitle>
            <ul className="space-y-1.5">
              {cluster.differences.map((difference, index) => (
                <li key={index} className="flex gap-2 text-[12px] leading-relaxed text-ink-muted">
                  <span aria-hidden className="mt-px shrink-0 font-mono text-ink-subtle">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{difference}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-subtle uppercase">
      {children}
    </h3>
  );
}

function DrawerMessage({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <header className="flex shrink-0 items-center justify-end border-b border-line px-6 py-4">
        <CloseButton onClose={onClose} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[13px]">
        {children}
      </div>
    </>
  );
}

function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <>
      <header className="flex shrink-0 items-start justify-between border-b border-line px-6 py-4">
        <div className="space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-inset" />
          <div className="h-3 w-72 animate-pulse rounded bg-inset" />
        </div>
        <CloseButton onClose={onClose} />
      </header>
      <div className="flex-1 space-y-3 px-6 py-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-lg bg-panel" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-lg bg-panel" />
      </div>
    </>
  );
}
