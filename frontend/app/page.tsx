import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { fetchRepo, fetchRepos } from '@/services/ditto.api';
import { rankRepos, toRanked, type RankedRepo } from '@/lib/repo-ranking';
import { MockDataNotice } from '@/components/ui/mock-data-notice';
import { HeroRepoButton } from '@/components/landing/hero-repo-button';
import { RepoPicker } from '@/components/landing/repo-picker';
import { RestrictedNotice } from '@/components/landing/restricted-notice';
import { HowItWorksStrip } from '@/components/landing/how-it-works-strip';
import { PortfolioEvidence } from '@/components/landing/portfolio-evidence';
import { GuardRoadmapCard } from '@/components/landing/guard-roadmap-card';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { 
  Code2, Cpu, ShieldAlert, Sparkles, Terminal, Zap, 
  GitPullRequest, Layers, ShieldCheck, CheckCircle2, 
  Milestone, BrainCircuit, ShieldAlert as AlertIcon, Info
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Ditto — Semantic CI',
  description:
    'Ditto finds functions that do the same thing written completely differently, then executes them to prove they disagree.',
};

export const dynamic = 'force-dynamic';

/**
 * Curated one-liners, keyed by `owner/name` — repo ids are database ids and
 * differ per environment, so keying on them silently fell back to a generic
 * blurb for every card. Anything without a curated line gets an honest
 * description generated from its own findings (see `blurbFor`).
 */
const CURATED_BLURBS: Record<string, string> = {
  'cline/cline': 'Four functions named truncateText, one package, three different answers.',
};

function blurbFor({ repo, stats, provenDivergences }: RankedRepo): string {
  const curated = CURATED_BLURBS[`${repo.owner}/${repo.name}`.toLowerCase()];
  if (curated) return curated;
  if (!stats) return 'Indexed by Ditto.';
  if (provenDivergences > 0) {
    return `${provenDivergences} cluster${provenDivergences === 1 ? '' : 's'} executed and proven to disagree.`;
  }
  if (stats.semanticDuplicateClusters > 0) {
    return `${stats.semanticDuplicateClusters} semantic clusters — none proven to disagree.`;
  }
  return 'No semantic duplicates found — nothing to consolidate.';
}

export default function Home() {
  return (
    <div className="relative min-h-screen w-full bg-canvas text-ink overflow-x-hidden">
      {/* Matrix dot-grid backdrop */}
      <div 
        className="absolute inset-0 -z-10 opacity-[0.25] dark:opacity-[0.12]"
        style={{ 
          backgroundImage: 'radial-gradient(var(--line-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />
      
      {/* Ambient color gradient blobs */}
      <div className="absolute top-[-150px] left-[15%] -z-10 h-[600px] w-[600px] rounded-full bg-accent/8 blur-[130px] pointer-events-none" />
      <div className="absolute top-[250px] right-[10%] -z-10 h-[500px] w-[500px] rounded-full bg-ai/6 blur-[110px] pointer-events-none" />
      <div className="absolute bottom-[400px] left-[5%] -z-10 h-[450px] w-[450px] rounded-full bg-danger/4 blur-[100px] pointer-events-none" />

      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5 text-ink hover:opacity-90 transition-opacity duration-150">
            <img src="/logo/ditto_dark_bg.png" alt="Ditto Logo" className="logo-dark-theme h-6 w-auto shrink-0" />
            <img src="/logo/ditto_white_bg.png" alt="Ditto Logo" className="logo-light-theme h-6 w-auto shrink-0" />
            <span className="rounded bg-inset border border-line px-1.5 py-px font-mono text-[9px] tracking-wider text-ink-subtle uppercase">
              Semantic CI
            </span>
          </Link>
          
          <div className="ml-auto flex items-center gap-5">
            <a href="#why-ditto" className="hidden text-[11px] font-mono tracking-wider text-ink-muted hover:text-ink transition-colors duration-150 sm:inline uppercase">Why Ditto</a>
            <a href="#how-it-works" className="hidden text-[11px] font-mono tracking-wider text-ink-muted hover:text-ink transition-colors duration-150 sm:inline uppercase">Architecture</a>
            <a href="#compare" className="hidden text-[11px] font-mono tracking-wider text-ink-muted hover:text-ink transition-colors duration-150 sm:inline uppercase">Compare</a>
            <a href="#roadmap" className="hidden text-[11px] font-mono tracking-wider text-ink-muted hover:text-ink transition-colors duration-150 sm:inline uppercase">Roadmap</a>
            <span className="hidden h-3.5 w-px bg-line-strong sm:inline" />
            <MockDataNotice />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 md:py-20 gap-20">
        
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center space-y-6 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-bg/40 px-3 py-1 font-mono text-[10px] tracking-wider text-accent uppercase">
            <ShieldCheck className="size-3" /> Zero-Hallucination Semantic Code Audit
          </div>
          
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-balance leading-[1.12] text-ink">
            Your CI asks if the code compiles. <br />
            Ditto asks if you just{' '}
            <span className="bg-gradient-to-r from-accent via-ai to-danger bg-clip-text text-transparent">
              rewrote existing logic
            </span>.
          </h1>
          
          <p className="text-[14px] md:text-base leading-relaxed text-ink-muted text-balance max-w-2xl">
            Duplication tools match text copy-pastes. Ditto compiles the AST, maps intentions using AI, and executes pure functions side-by-side in a V8 sandbox to verify behavioral drift. 
            <strong className="text-ink block mt-2 font-medium">Built for large scale. Verified by Node.js, not by AI guessing.</strong>
          </p>

          <div className="w-full max-w-lg pt-4">
            <RepoPicker />
          </div>

          {/* Explains the analysis cap before anyone pastes into it. Renders
              nothing when restricted mode is off. */}
          <div className="w-full max-w-2xl">
            <RestrictedNotice />
          </div>
        </section>

        {/* What Ditto does, and the six stages it runs. Static — renders with
            the shell, no data needed. */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <Layers className="size-4 text-ink-subtle" />
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
              What Ditto Does
            </h2>
          </div>
          <HowItWorksStrip />
        </section>

        {/* Ready Repos Section */}
        <section id="indexed-repos" className="space-y-4 scroll-mt-20">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <Terminal className="size-4 text-ink-subtle" />
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
              Indexed Repositories (Verified Clones)
            </h2>
          </div>
          {/* Streamed: the largest repo's detail endpoint takes ~8s, so the
              cards arrive on their own without holding up the whole page. */}
          <Suspense fallback={<RepoCardsSkeleton />}>
            <IndexedRepos />
          </Suspense>
        </section>

        {/* The AI Slop Problem Section */}
        <section id="why-ditto" className="rounded-2xl border border-line bg-panel p-6 md:p-8 space-y-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 -z-10 h-32 w-32 rounded-full bg-warn/4 blur-[24px] pointer-events-none" />
          
          <div className="flex flex-col md:flex-row gap-6 md:gap-10">
            <div className="md:w-1/3 space-y-3">
              <div className="inline-flex size-8 items-center justify-center rounded-lg bg-warn-bg border border-warn-line text-warn">
                <BrainCircuit className="size-4" />
              </div>
              <h2 className="text-lg font-bold text-ink">The AI-Agent Slop Crisis</h2>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                How coding assistants and context limitations are quietly degrading modern corporate codebases.
              </p>
            </div>
            
            <div className="flex-1 space-y-4 text-xs md:text-[13px] leading-relaxed text-ink-muted">
              <p>
                Today, <strong className="text-ink font-medium">over 80% of software engineers use AI coding tools</strong> (Copilot, Cursor, Devin) daily. These tools write code extremely fast, but they have a fatal design flaw: <strong className="text-ink font-medium">they operate as local optimizers</strong>. Because models are context-constrained and rely on basic vector RAG lookup, they cannot examine your entire codebase before writing a line of code.
              </p>
              <p>
                When an AI agent needs a simple date helper or string formatter, it doesn&apos;t search deep private subdirectories — it simply <strong className="text-ink font-medium">re-implements the logic from scratch</strong> under a different name in a new file.
              </p>
              <div className="border-l-2 border-accent-line pl-3 py-1 bg-inset/50 rounded-r my-2">
                <strong className="text-ink font-medium">The correctness cliff:</strong> Over months, you accumulate four functions doing the same job written completely differently. Standard CI accepts this because each copy passes its own file-level tests in isolation. But they behave slightly differently on edge cases, causing <strong className="text-ink font-medium">silent behavioral drift</strong> that breaks production.
              </div>
              <p>
                Ditto acts as a persistent <strong className="text-ink font-medium">Semantic Memory Layer</strong>. Instead of letting slop compile, Ditto indexes your repository&apos;s behavioral intent, clusters clones, and proves where they diverge by executing them side-by-side.
              </p>
            </div>
          </div>
        </section>

        {/* How it Works / Architecture */}
        <section id="how-it-works" className="space-y-6">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <Layers className="size-4 text-ink-subtle" />
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
              Top-Tier Architecture: Zero-Hallucination Verification
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-line bg-panel p-5 space-y-3 hover:border-line-strong transition-colors duration-150">
              <div className="flex size-8 items-center justify-center rounded-lg bg-inset border border-line text-ink">
                <Code2 className="size-4" />
              </div>
              <h3 className="font-mono text-[13px] font-semibold text-ink">1. AST Parser</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted font-sans">
                Instead of simple text-grepping, Ditto compiles code into an Abstract Syntax Tree using <code className="font-mono text-[11px] text-ink">ts-morph</code>. Grabs all functions—including file-local, private, and nested declarations.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 space-y-3 hover:border-line-strong transition-colors duration-150">
              <div className="flex size-8 items-center justify-center rounded-lg bg-ai-bg border border-ai-line text-ai">
                <Sparkles className="size-4" />
              </div>
              <h3 className="font-mono text-[13px] font-semibold text-ink">2. AI Fingerprinting</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Translates logic into behavior templates using structured LLM outputs. AI does not judge code quality; it acts as a translator, removing variable names, styles, and format biases.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 space-y-3 hover:border-line-strong transition-colors duration-150">
              <div className="flex size-8 items-center justify-center rounded-lg bg-accent-bg border border-accent-line text-accent">
                <Cpu className="size-4" />
              </div>
              <h3 className="font-mono text-[13px] font-semibold text-ink">3. Matrix Pruning</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Compares summaries using vector embeddings. To bypass the costly <code className="font-mono text-[11px] text-ink">O(N²)</code> LLM comparison limit, Ditto uses fast in-memory cosine similarity math to prune millions of pairs in milliseconds.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 space-y-3 hover:border-line-strong transition-colors duration-150">
              <div className="flex size-8 items-center justify-center rounded-lg bg-danger-bg border border-danger-line text-danger">
                <ShieldAlert className="size-4" />
              </div>
              <h3 className="font-mono text-[13px] font-semibold text-ink">4. V8 worker_threads</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                The killer step: Ditto executes pure functions in isolated worker threads against adversarial boundary values. If they disagree on output, it renders proof. <strong className="text-ink">Reality, not model opinions.</strong>
              </p>
            </div>
          </div>
        </section>

        {/* Not an AI wrapper card */}
        <section className="rounded-2xl border border-line bg-panel p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded bg-inset border border-line-strong text-accent font-mono text-xs font-bold">i</span>
            <h2 className="text-base font-bold text-ink">Why Ditto is Not an &quot;AI Wrapper&quot; or Bloat</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs md:text-[13px] leading-relaxed text-ink-muted">
            <div className="space-y-3">
              <p>
                Many modern developer tools are simple prompts wrapped in an Express server, running full-codebase lookups that blow context windows and cost thousands of dollars. <strong className="text-ink font-medium">Ditto is an actual static analyzer combined with sandbox execution.</strong>
              </p>
              <p>
                AI is strictly load-bearing in <strong className="text-ink font-medium">two isolated stages</strong> where regex patterns fail: normalizing structural differences into behavioral summaries, and guessing interesting inputs (empty values, limits, sign-flips).
              </p>
            </div>
            <div className="space-y-3">
              <p>
                The heavy lifting—grouping functions, extracting code syntax, running isolates, and compiling diffs—uses <strong className="text-ink font-medium">hard, deterministic algorithms</strong>.
              </p>
              <p>
                By executing the code in Node worker threads, we take the LLM out of the final verdict. When Ditto tells you a budget parser is broken, it&apos;s because <strong className="text-ink font-medium">V8 ran the functions side-by-side and got different answers.</strong>
              </p>
            </div>
          </div>
        </section>

        {/* Compare Table */}
        <section id="compare" className="space-y-6">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <GitPullRequest className="size-4 text-ink-subtle" />
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
              The Blindspot — Token Matchers vs Semantic CI
            </h2>
          </div>

          <div className="rounded-xl border border-line bg-panel overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 border-b border-line bg-inset/50 font-mono text-[10px] text-ink-subtle tracking-wider uppercase">
              <div className="px-5 py-3">Capability</div>
              <div className="px-5 py-3 border-t md:border-t-0 md:border-l border-line">Traditional Tools (jscpd, Sonar)</div>
              <div className="px-5 py-3 border-t md:border-t-0 md:border-l border-line">Ditto (Semantic CI)</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border-b border-line/60">
              <div className="px-5 py-3.5 font-semibold text-ink">Identifies Type 1–3 Clones</div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Yes (exact or modified text duplicates)
              </div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Yes (as low-risk near-duplicates)
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border-b border-line/60">
              <div className="px-5 py-3.5 font-semibold text-ink">Identifies Type-4 Clones</div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-danger">🔴</span> No (different code structure = 0 matching)
              </div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Yes (matches intent, ignores code details)
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border-b border-line/60">
              <div className="px-5 py-3.5 font-semibold text-ink">Analyzes Non-Exported Code</div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Yes (indexes raw text streams)
              </div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Yes (ast-walk grabs file-local methods)
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="px-5 py-3.5 font-semibold text-ink">Behavioral Verification</div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-danger">🔴</span> None (static character analysis only)
              </div>
              <div className="px-5 py-3.5 md:border-l border-line text-ink-muted flex items-center gap-1.5 text-xs">
                <span className="text-success">🟢</span> Live sandbox runs prove disagreements
              </div>
            </div>
          </div>
        </section>

        {/* Roadmap / Future section */}
        <section id="roadmap" className="space-y-6">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <Milestone className="size-4 text-ink-subtle" />
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">
              Roadmap: End-to-End Slop Prevention
            </h2>
          </div>

          {/* Next up, clearly marked as not shipped. */}
          <GuardRoadmapCard />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-line bg-panel p-5 space-y-2.5 relative">
              <span className="absolute top-4 right-4 rounded bg-success-bg/25 border border-success-line px-1.5 py-0.5 font-mono text-[9px] text-success uppercase">
                Active Demo
              </span>
              <h3 className="font-mono text-[13px] font-bold text-ink">Stage 1: Repository Memory</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Run static AST walk and cosine matrix clustering to detect and catalog semantic duplicate clusters and behavioral conflicts in existing code.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 space-y-2.5 relative">
              <span className="absolute top-4 right-4 rounded bg-accent-bg/40 border border-accent-line px-1.5 py-0.5 font-mono text-[9px] text-accent uppercase">
                Launching Soon
              </span>
              <h3 className="font-mono text-[13px] font-bold text-ink">Stage 2: Ditto Guard (CI)</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Lightweight CI check that only analyzes the PR diff (~$0.01 per check). Blocks PR merges if a developer introduces a semantic duplication.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 space-y-2.5 relative">
              <span className="absolute top-4 right-4 rounded bg-inset border border-line-strong px-1.5 py-0.5 font-mono text-[9px] text-ink-subtle uppercase">
                Roadmap
              </span>
              <h3 className="font-mono text-[13px] font-bold text-ink">Stage 3: MCP Agent Pre-flight</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Integrates into coding agents (Cursor, Devin) via the Model Context Protocol. Let agents query Ditto&apos;s index and reuse code *before* re-implementing.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-line pt-8 pb-12 flex flex-col sm:flex-row items-center justify-between text-xs text-ink-subtle gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo/ditto_dark_bg.png" alt="Ditto Logo" className="logo-dark-theme h-4 w-auto shrink-0 opacity-70" />
            <img src="/logo/ditto_white_bg.png" alt="Ditto Logo" className="logo-light-theme h-4 w-auto shrink-0 opacity-70" />
            <span>© 2026 Ditto Labs. Built for Hackathon.</span>
          </div>
          <div className="flex items-center gap-4 font-mono">
            <a href="https://github.com/cline/cline" target="_blank" rel="noreferrer" className="hover:text-ink">Cline Repo</a>
            <span>•</span>
            <a href="https://github.com/actualbudget/actual" target="_blank" rel="noreferrer" className="hover:text-ink">Actual Budget Repo</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

/**
 * Fetches every indexed repo's metrics on the SERVER, in parallel, then orders
 * the cards by interestingness before they render.
 *
 * This has to happen server-side: the sort depends on stats, so the stats must
 * be known before the list is laid out. It also fixes the card that used to
 * fetch its own metrics on mount and lose the race — `Promise.allSettled` means
 * one slow or failing repo degrades to a single metric-less card instead of
 * taking the section down with it.
 */
async function IndexedRepos() {
  const repos = await fetchRepos();
  const settled = await Promise.allSettled(repos.map((repo) => fetchRepo(repo.id)));

  const ranked = rankRepos(
    repos.map((repo, i) => {
      const result = settled[i];
      if (result.status === 'fulfilled') return toRanked(result.value);
      console.error(`[ditto] could not load stats for ${repo.owner}/${repo.name}`, result.reason);
      return { repo, stats: null, provenDivergences: 0 };
    }),
  );

  return (
    <div className="space-y-4">
      {/* Totals summed from exactly these repos — same fetch, so the evidence
          line can never disagree with the cards under it. */}
      <PortfolioEvidence repos={ranked} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ranked.map((entry) => (
          <HeroRepoButton key={entry.repo.id} {...entry} blurb={blurbFor(entry)} />
        ))}
      </div>
    </div>
  );
}

function RepoCardsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-16 w-full animate-pulse rounded-xl bg-panel" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-panel p-5">
            <div className="h-5 w-44 animate-pulse rounded bg-inset" />
            <div className="mt-2 h-4 w-60 animate-pulse rounded bg-inset" />
            <div className="mt-6 h-4 w-full animate-pulse rounded bg-inset" />
          </div>
        ))}
      </div>
    </div>
  );
}
