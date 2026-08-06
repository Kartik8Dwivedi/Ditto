import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CheckCircle2, GitPullRequest, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { PrAnalysis, RepoSummary } from '@/types/ditto';
import { DittoApiError, fetchPrAnalysis } from '@/services/ditto.api';
import { findingState } from '@/lib/pr-finding';
import { RepoHeader } from '@/components/map/repo-header';
import { PrFindingCard } from '@/components/pr/pr-finding-card';

// Live backend data, rendered per request (never prerendered at build).
export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/pr/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const pr = await fetchPrAnalysis(id);
    return { title: `${pr.owner}/${pr.name} #${pr.prNumber} · Ditto` };
  } catch {
    return { title: 'Pull request · Ditto' };
  }
}

/** Order proven findings first, then suspected, then novel. */
const STATE_RANK = { proven: 0, suspected: 1, novel: 2 } as const;

export default async function PrPage(props: PageProps<'/pr/[id]'>) {
  const { id } = await props.params;

  let pr: PrAnalysis;
  try {
    pr = await fetchPrAnalysis(id);
  } catch (error) {
    if (error instanceof DittoApiError && error.kind === 'not_found') notFound();
    throw error;
  }

  // RepoHeader is reused verbatim — a PR analysis carries everything it needs.
  const repo: RepoSummary = {
    id: pr.id,
    owner: pr.owner,
    name: pr.name,
    commit: pr.headSha.slice(0, 7),
    indexedAt: pr.createdAt,
  };

  const findings = [...pr.findings].sort(
    (a, b) => STATE_RANK[findingState(a)] - STATE_RANK[findingState(b)],
  );

  // Honest counts only — every number below is a length of an array we actually
  // have. Nothing is invented (§0/§6).
  const proven = pr.findings.filter((f) => findingState(f) === 'proven').length;
  const suspected = pr.findings.filter((f) => findingState(f) === 'suspected').length;
  const novel = pr.findings.filter((f) => findingState(f) === 'novel').length;

  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-x-hidden bg-canvas text-ink">
      {/* Grid backdrop */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.2] dark:opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(var(--line-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute top-0 right-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-accent/6 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-10 left-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-danger/4 blur-[100px]" />

      <RepoHeader repo={repo} />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-6 py-8">
        {/* PR context banner */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-inset text-ink-subtle"
            >
              <GitPullRequest className="size-4" />
            </span>
            <div>
              <h1 className="text-[15px] font-semibold text-ink">
                <a
                  href={pr.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-accent"
                >
                  {pr.owner}/{pr.name}
                  <span className="text-ink-subtle"> #{pr.prNumber}</span>
                </a>
              </h1>
              <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                {pr.changedFunctions.toLocaleString('en-US')} changed function
                {pr.changedFunctions === 1 ? '' : 's'} analysed for reuse
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="danger" icon={<TriangleAlert className="size-3" />} value={proven} label="proven" />
            <Chip tone="warn" icon={<ShieldAlert className="size-3" />} value={suspected} label="suspected" />
            <Chip tone="success" icon={<CheckCircle2 className="size-3" />} value={novel} label="novel" />
          </div>
        </div>

        {/* Findings */}
        {findings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-panel px-4 py-10 text-center">
            <p className="text-[13px] text-ink">No reinvented functions in this PR.</p>
            <p className="mt-1 text-[12px] text-ink-muted">
              Ditto fingerprinted the functions this PR changed and none of them reinvent an existing
              implementation. That is a good result.
            </p>
          </div>
        ) : (
          <section className="space-y-4">
            {findings.map((finding, index) => (
              <PrFindingCard key={index} finding={finding} index={index} />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function Chip({
  tone,
  icon,
  value,
  label,
}: {
  tone: 'danger' | 'warn' | 'success';
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-success';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-inset px-2 py-1 font-mono text-[11px]">
      <span className={color}>{icon}</span>
      <span className={`tnum font-semibold ${color}`}>{value}</span>
      <span className="text-ink-subtle">{label}</span>
    </span>
  );
}
