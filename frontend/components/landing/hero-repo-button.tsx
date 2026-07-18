'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, GitBranch, ShieldAlert, Sparkles, Database } from 'lucide-react';
import type { RepoSummary, RepoStats } from '@/types/ditto';
import { fetchRepo } from '@/services/ditto.api';
import { cn } from '@/lib/utils';

export function HeroRepoButton({ repo: initialRepo, blurb }: { repo: RepoSummary; blurb: string }) {
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchRepo(initialRepo.id)
      .then((data) => {
        if (active) {
          setStats(data.stats);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch stats for ${initialRepo.id}:`, err);
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [initialRepo.id]);

  const score = stats?.healthScore;
  const isHealthy = score !== undefined ? score >= 80 : true;
  const isWarning = score !== undefined ? score >= 50 && score < 80 : false;
  
  return (
    <Link
      href={`/repo/${initialRepo.id}`}
      className="group block rounded-xl border border-line bg-panel p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-inset hover:shadow-lg hover:shadow-black/20"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold tracking-tight text-ink group-hover:text-accent transition-colors duration-150">
              {initialRepo.owner}
              <span className="text-ink-subtle">/</span>
              {initialRepo.name}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-panel border border-line px-2 py-0.5 font-mono text-[10px] text-ink-muted">
              <GitBranch aria-hidden className="size-2.5" />
              {initialRepo.commit}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{blurb}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 self-end sm:self-start">
            <div className="text-right space-y-1">
              <div className="h-3 w-14 bg-line-strong rounded animate-pulse" />
              <div className="h-5 w-8 bg-line-strong rounded animate-pulse" />
            </div>
            <span className="h-6 w-px bg-line-strong" />
            <div className="h-6 w-16 bg-line-strong rounded animate-pulse" />
          </div>
        ) : score !== undefined ? (
          <div className="flex items-center gap-3 self-end sm:self-start">
            <div className="text-right">
              <div className="font-mono text-xs text-ink-subtle">Ditto Score</div>
              <div className={cn(
                "font-mono text-xl font-bold leading-none mt-0.5",
                isHealthy && "text-success",
                isWarning && "text-warn",
                !isHealthy && !isWarning && "text-danger"
              )}>
                {score}<span className="text-[10px] font-normal text-ink-subtle">/100</span>
              </div>
            </div>
            <span className="h-6 w-px bg-line-strong" />
            <div className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-semibold border uppercase tracking-wider",
              isHealthy && "bg-success-bg/20 border-success-line text-success",
              isWarning && "bg-warn-bg/20 border-warn-line text-warn",
              !isHealthy && !isWarning && "bg-danger-bg/20 border-danger-line text-danger"
            )}>
              {isHealthy ? 'Healthy' : isWarning ? 'Needs Work' : 'Dupe Risk'}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between border-t border-line/60 pt-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-ink-subtle">
          {loading ? (
            <div className="h-4 w-48 bg-line-strong rounded animate-pulse" />
          ) : stats ? (
            <>
              <span className="flex items-center gap-1.5">
                <Database className="size-3 text-ink-subtle" />
                <strong className="text-ink-muted font-medium">{stats.functions.toLocaleString('en-US')}</strong> functions
              </span>
              <span className="hidden sm:inline text-line">•</span>
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-ai" />
                <strong className="text-ink-muted font-medium">{stats.semanticDuplicateClusters}</strong> clusters
              </span>
              {stats.behavioralConflicts > 0 && (
                <>
                  <span className="hidden sm:inline text-line">•</span>
                  <span className="flex items-center gap-1.5 text-danger">
                    <ShieldAlert className="size-3" />
                    <strong className="font-bold">{stats.behavioralConflicts}</strong> conflicts proven
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="text-ink-subtle">Select to load repo metrics</span>
          )}
        </div>

        <div className="flex items-center gap-1 font-mono text-xs text-ink-subtle group-hover:text-ink transition-colors duration-150">
          Open Intelligence
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform duration-150 group-hover:translate-x-1"
          />
        </div>
      </div>
    </Link>
  );
}
