import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DittoApiError, fetchRepo } from '@/services/ditto.api';
import { ClusterList } from '@/components/map/cluster-list';
import { DittoScore } from '@/components/map/ditto-score';
import { IntelligencePanel } from '@/components/map/intelligence-panel';
import { JscpdStrip } from '@/components/map/jscpd-strip';
import { RepoHeader } from '@/components/map/repo-header';
import { TruncationNotice } from '@/components/map/truncation-notice';
import { Database, ShieldAlert } from 'lucide-react';

// Live backend data, rendered per request (never prerendered at build).
export const dynamic = 'force-dynamic';

// `params` is a Promise in Next 16 — synchronous access was removed entirely.
export async function generateMetadata(props: PageProps<'/repo/[repoId]'>): Promise<Metadata> {
  const { repoId } = await props.params;
  try {
    const { repo } = await fetchRepo(repoId);
    return { title: `${repo.owner}/${repo.name} · Ditto` };
  } catch {
    return { title: 'Repository · Ditto' };
  }
}

export default async function RepoPage(props: PageProps<'/repo/[repoId]'>) {
  const { repoId } = await props.params;

  let data;
  try {
    data = await fetchRepo(repoId);
  } catch (error) {
    if (error instanceof DittoApiError && error.kind === 'not_found') notFound();
    throw error;
  }

  const { repo, stats, clusters } = data;

  return (
    <div className="relative flex flex-1 flex-col min-h-screen bg-canvas text-ink overflow-x-hidden">
      {/* Grid backdrop */}
      <div 
        className="absolute inset-0 -z-10 opacity-[0.2] dark:opacity-[0.12]"
        style={{ 
          backgroundImage: 'radial-gradient(var(--line-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />
      
      {/* Background soft glowing auras */}
      <div className="absolute top-0 right-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-accent/6 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 left-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-danger/4 blur-[100px] pointer-events-none" />

      <RepoHeader repo={repo} />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-[280px] lg:self-start space-y-4">
          <div className="pb-2 border-b border-line">
            <h1 className="font-mono text-[11px] font-bold tracking-[0.16em] text-ink uppercase">
              Repository Info
            </h1>
            <p className="mt-1.5 text-[12px] text-ink-muted leading-relaxed">
              Analyzed{' '}
              <span className="tnum font-mono text-ink font-semibold">{stats.functions.toLocaleString('en-US')}</span>{' '}
              functions across{' '}
              <span className="tnum font-mono text-ink font-semibold">{stats.files.toLocaleString('en-US')}</span>{' '}
              files.
            </p>
          </div>

          <DittoScore score={stats.healthScore} />

          <IntelligencePanel stats={stats} clusters={clusters} />
        </aside>

        {/* Main Content Area */}
        <main className="min-w-0 flex-1 space-y-6">
          {/* Renders only when the live pipeline capped the analysis. */}
          <TruncationNotice stats={stats} />

          <JscpdStrip stats={stats} clusters={clusters} />

          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <div className="flex items-center gap-2">
                <Database className="size-3.5 text-ink-subtle" />
                <h2 className="font-mono text-[11px] font-bold tracking-[0.16em] text-ink uppercase">
                  Semantic Duplicate Clusters
                </h2>
              </div>
              <p className="text-[11px] text-ink-subtle">
                Sorted by risk · Click row for verification proof
              </p>
            </div>
            <ClusterList clusters={clusters} />
          </section>
        </main>
      </div>
    </div>
  );
}
