import type { Metadata } from 'next';
import { fetchRepos } from '@/services/ditto.api';
import { DittoMark } from '@/components/ui/ditto-mark';
import { MockDataNotice } from '@/components/ui/mock-data-notice';
import { HeroRepoButton } from '@/components/landing/hero-repo-button';
import { RepoPicker } from '@/components/landing/repo-picker';

export const metadata: Metadata = {
  title: 'Ditto — Semantic CI',
  description:
    'Ditto finds functions that do the same thing written completely differently, then executes them to prove they disagree.',
};

// The repo list is live backend data now, so this page renders per request
// rather than being prerendered at build time (when the backend isn't running).
export const dynamic = 'force-dynamic';

/** One line per hero repo, keyed by repo id. The landing is not the product. */
const BLURBS: Record<string, string> = {
  'cline-cline': 'Four functions named truncateText, one package, three different answers.',
  'actualbudget-actual': 'Two ways to read (1,234.56). One says credit, one says debit.',
  'ditto-labs-ditto': 'Ditto, analysed by Ditto — the duplicates our own agents wrote.',
};

export default async function Home() {
  const repos = await fetchRepos();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="mb-7">
          <div className="mb-4 flex items-center gap-2">
            <DittoMark className="size-5 text-accent" />
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">
              ditto
            </span>
            <span className="rounded bg-inset px-1.5 py-px font-mono text-[10px] tracking-wider text-ink-subtle uppercase">
              Semantic CI
            </span>
            <span className="ml-auto">
              <MockDataNotice />
            </span>
          </div>

          <h1 className="text-[22px] leading-snug font-semibold tracking-tight text-balance text-ink">
            Your CI asks whether the code compiles. Ditto asks whether you just rewrote something you
            already had.
          </h1>

          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            Token-based tools return literal zero for functions that do the same thing written
            differently. Ditto finds them — then{' '}
            <span className="text-ink">executes them on the same input to prove they disagree.</span>
          </p>
        </div>

        <RepoPicker repos={repos} />

        <div className="mt-6">
          <p className="mb-2 font-mono text-[10px] tracking-[0.16em] text-ink-subtle uppercase">
            Indexed and ready
          </p>
          <div className="space-y-2">
            {repos.map((repo) => (
              <HeroRepoButton
                key={repo.id}
                repo={repo}
                blurb={BLURBS[repo.id] ?? 'Indexed by Ditto.'}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
