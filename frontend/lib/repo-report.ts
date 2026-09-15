/**
 * The Intelligence Map as a Markdown report — something a user can paste into a
 * PR, an issue, or a tech-debt doc.
 *
 * Pure formatting over `RepoDetail`. Every claim is read from the same helpers
 * the map uses, so the report can never say more than the screen does:
 *
 *   · suspected and proven conflicts stay two separate numbers (repo-metrics)
 *   · every verdict comes from `verdictFor`, never re-derived here
 *   · the partial-analysis and fixtures notices travel with the findings
 */
import type { ClusterSummary, RepoDetail, RepoStats, RepoSummary } from '@/types/ditto';
import { verdictFor } from '@/lib/cluster-verdict';
import {
  countProvenDivergences,
  countSuspectedConflicts,
  PROVEN_LABEL,
  SUSPECTED_LABEL,
} from '@/lib/repo-metrics';
import { sortByRisk } from '@/lib/mocks/derive';
import { scoreBand } from '@/components/map/ditto-score';
import { isPartialAnalysis } from '@/components/map/truncation-notice';

export type RepoReportOptions = {
  /** Passed in rather than read from the clock, so the builder stays pure. */
  generatedAt: Date;
  /** The map is rendering fixtures — the report has to say so too. */
  fromFixtures: boolean;
};

/** `owner-repo.md`, with anything outside a safe filename charset collapsed to `-`. */
export function reportFilename(repo: Pick<RepoSummary, 'owner' | 'name'>): string {
  const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe(repo.owner)}-${safe(repo.name)}.md`;
}

/** Absolute and in UTC, like the header — a pasted report must not go stale. */
function formatUtc(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A table cell: a pipe would end the cell, and a raw `<` can be eaten as HTML. */
function cellText(text: string): string {
  return oneLine(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/</g, '&lt;');
}

function cellCode(text: string): string {
  const line = oneLine(text);
  if (line.includes('`')) return cellText(line);
  return `\`${line.replace(/\|/g, '\\|')}\``;
}

function summaryTable(stats: RepoStats, clusters: ClusterSummary[]): string[] {
  const rows: [string, string][] = [
    ['Functions Analyzed', formatCount(stats.functions)],
    ['Files', formatCount(stats.files)],
    ['Semantic Duplicate Clusters', formatCount(stats.semanticDuplicateClusters)],
    [SUSPECTED_LABEL, formatCount(countSuspectedConflicts(stats))],
    [PROVEN_LABEL, formatCount(countProvenDivergences(clusters))],
    ['Near-Duplicate Implementations', formatCount(stats.nearDuplicates)],
    ['Reusable Utilities Identified', formatCount(stats.reusableUtilities)],
    ['Suspected Reinvented Utilities', formatCount(stats.suspectedReinvented)],
    ['Lines Removable', `~${formatCount(stats.linesRemovable)}`],
    ['Unifiable Call Sites', formatCount(stats.callSitesUnifiable)],
  ];

  return [
    '| Metric | Count |',
    '| --- | ---: |',
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
  ];
}

function clusterTable(clusters: ClusterSummary[]): string[] {
  return [
    '| # | Domain | Behaviour | Members | Confidence | Verdict | Proven? |',
    '| ---: | --- | --- | ---: | ---: | --- | --- |',
    // Same order as the map's default view.
    ...sortByRisk(clusters).map((cluster, index) =>
      [
        '',
        index + 1,
        cellCode(cluster.domain),
        cellText(cluster.behaviorSummary),
        cluster.memberCount,
        cluster.confidence.toFixed(2),
        verdictFor(cluster).label,
        cluster.hasProvenDivergence ? 'Yes' : 'No',
        '',
      ]
        .join(' | ')
        .trim(),
    ),
  ];
}

export function buildRepoReport(detail: RepoDetail, options: RepoReportOptions): string {
  const { repo, stats, clusters } = detail;
  const lines: string[] = [
    `# Ditto report: ${repo.owner}/${repo.name}`,
    '',
    `Commit \`${repo.commit}\` · indexed ${formatUtc(repo.indexedAt)} · generated ${formatUtc(options.generatedAt)}`,
    '',
  ];

  if (options.fromFixtures) {
    lines.push(
      '> **Demo fixtures.** This report was generated from demo fixtures, not a live analysis of a real repository.',
      '',
    );
  }

  if (isPartialAnalysis(stats)) {
    lines.push(
      `> **Partial analysis.** Analysed the first ${formatCount(stats.functionsAnalyzed)} of ${formatCount(stats.functionsTotal)} functions (live demo cap). There may be duplicates in the part Ditto has not read.`,
      '',
    );
  }

  lines.push(
    '## Ditto Score',
    '',
    `**${stats.healthScore}/100** · ${scoreBand(stats.healthScore).note}`,
    '',
    '## Summary',
    '',
    ...summaryTable(stats, clusters),
    '',
    `_${SUSPECTED_LABEL}_ are the model's judgement — nothing was executed. _${PROVEN_LABEL}_ counts clusters Ditto actually ran on the same inputs and watched return different answers.`,
    '',
    '## Semantic Duplicate Clusters',
    '',
  );

  if (clusters.length === 0) {
    lines.push(
      'No semantic duplicate clusters found. Every function Ditto fingerprinted in this repo looks like it does its own job.',
    );
  } else {
    lines.push(...clusterTable(clusters));
  }

  lines.push('', '---', '', '_Generated by Ditto._');
  return `${lines.join('\n')}\n`;
}
