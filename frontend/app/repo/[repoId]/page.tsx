import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DittoApiError, fetchRepo } from '@/services/ditto.api';
import { ANALYSIS_FUNCTION_CAP } from '@/lib/constants';
import { ClusterList } from '@/components/map/cluster-list';
import { DittoScore } from '@/components/map/ditto-score';
import { IntelligencePanel } from '@/components/map/intelligence-panel';
import { JscpdStrip } from '@/components/map/jscpd-strip';
import { RepoHeader } from '@/components/map/repo-header';
import { TruncationNotice } from '@/components/map/truncation-notice';

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
    // A missing repo is a 404, not a crash. Anything else is a real error and
    // belongs to error.tsx.
    if (error instanceof DittoApiError && error.kind === 'not_found') notFound();
    throw error;
  }

  const { repo, stats, clusters } = data;

  return (
    <div className="flex flex-1 flex-col">
      <RepoHeader repo={repo} />

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[300px] lg:self-start">
          <h1 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink uppercase">
            Repository Intelligence
          </h1>
          <p className="mt-1 mb-5 text-[12px] text-ink-muted">
            Analyzed{' '}
            <span className="tnum font-mono text-ink">{stats.functions.toLocaleString('en-US')}</span>{' '}
            functions ·{' '}
            <span className="tnum font-mono text-ink">{stats.files.toLocaleString('en-US')}</span>{' '}
            files ·{' '}
            <span className="tnum font-mono text-ink">{stats.modules.toLocaleString('en-US')}</span>{' '}
            modules
          </p>

          <IntelligencePanel stats={stats} clusters={clusters} />

          <div className="mt-5">
            <DittoScore score={stats.healthScore} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          {stats.functions >= ANALYSIS_FUNCTION_CAP && <TruncationNotice stats={stats} />}

          <JscpdStrip stats={stats} />

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink uppercase">
                Semantic Clusters
              </h2>
              <p className="text-[11px] text-ink-subtle">
                Sorted by risk · click a row to see the proof
              </p>
            </div>
            <ClusterList clusters={clusters} />
          </section>
        </main>
      </div>
    </div>
  );
}
