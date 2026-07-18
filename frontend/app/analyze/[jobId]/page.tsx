import type { Metadata } from 'next';
import { AnalysisProgress } from '@/components/analysis/analysis-progress';

export const metadata: Metadata = { title: 'Analysing… · Ditto' };

// The job is created client-side and polled per request — never prerendered.
export const dynamic = 'force-dynamic';

// `params` and `searchParams` are Promises in Next 16 — await them.
export default async function AnalyzePage(props: PageProps<'/analyze/[jobId]'>) {
  const { jobId } = await props.params;
  const { repo } = await props.searchParams;
  const repoSlug = typeof repo === 'string' ? repo : undefined;

  return (
    <main className="flex flex-1 flex-col">
      <AnalysisProgress jobId={jobId} repoSlug={repoSlug} />
    </main>
  );
}
