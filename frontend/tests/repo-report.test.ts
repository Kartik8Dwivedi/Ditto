import { describe, it, expect } from 'vitest';

import { buildRepoReport, reportFilename, type RepoReportOptions } from '@/lib/repo-report';
import { countProvenDivergences } from '@/lib/repo-metrics';
import { getMockRepo, getMockRepos } from '@/lib/mocks';
import type { ClusterSummary, RepoDetail, RepoStats, RepoSummary } from '@/types/ditto';

/**
 * The exported report is pasted into PRs and issues, so it must say exactly what
 * the map says — no more. In particular it must never merge "suspected" into
 * "proven", and it must never drop the fixtures or partial-analysis warnings.
 */

const repo: RepoSummary = {
  id: 'acme-widgets',
  owner: 'acme',
  name: 'widgets',
  commit: 'abc1234',
  indexedAt: '2026-07-17T09:24:11.000Z',
};

const stats = (overrides: Partial<RepoStats> = {}): RepoStats => ({
  functions: 1200,
  files: 300,
  modules: 40,
  semanticDuplicateClusters: 3,
  behavioralConflicts: 4,
  nearDuplicates: 6,
  reusableUtilities: 12,
  suspectedReinvented: 2,
  linesRemovable: 1500,
  callSitesUnifiable: 9,
  healthScore: 71,
  functionsTotal: 1200,
  functionsAnalyzed: 1200,
  ...overrides,
});

const cluster = (overrides: Partial<ClusterSummary> = {}): ClusterSummary => ({
  id: 'c1',
  domain: 'slugify',
  behaviorSummary: 'Turn a title into a URL slug',
  memberCount: 2,
  confidence: 0.9,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 10,
  ...overrides,
});

const detail = (overrides: Partial<RepoDetail> = {}): RepoDetail => ({
  repo,
  stats: stats(),
  clusters: [cluster()],
  ...overrides,
});

const options: RepoReportOptions = {
  generatedAt: new Date('2026-09-13T08:30:00.000Z'),
  fromFixtures: false,
};

const clusterRows = (markdown: string) =>
  markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));

/** Splits a table row on unescaped pipes, dropping the empty edge cells. */
const cellsOf = (row: string) =>
  row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());

describe('reportFilename', () => {
  it('names the file owner-repo.md', () => {
    expect(reportFilename(repo)).toBe('acme-widgets.md');
  });

  it('collapses characters that are unsafe in a filename', () => {
    expect(reportFilename({ owner: 'my org', name: 'a/b:c' })).toBe('my-org-a-b-c.md');
    expect(reportFilename({ owner: 'foo_bar', name: 'x.js' })).toBe('foo_bar-x.js.md');
  });
});

describe('buildRepoReport', () => {
  it('titles the report and stamps the commit, index time and export time in UTC', () => {
    const markdown = buildRepoReport(detail(), options);

    expect(markdown.startsWith('# Ditto report: acme/widgets\n')).toBe(true);
    expect(markdown).toContain(
      'Commit `abc1234` · indexed 2026-07-17 09:24 UTC · generated 2026-09-13 08:30 UTC',
    );
  });

  it.each([
    [85, 'Healthy'],
    [80, 'Healthy'],
    [79, 'Needs Consolidation'],
    [50, 'Needs Consolidation'],
    [49, 'High Duplication Risk'],
  ])('reports a score of %i with the same band as the meter (%s)', (healthScore, band) => {
    const markdown = buildRepoReport(detail({ stats: stats({ healthScore }) }), options);

    expect(markdown).toContain(`**${healthScore}/100** · ${band}`);
  });

  it('keeps suspected and proven conflicts as two separate numbers', () => {
    // The adjudicator flagged 4 as risky; only 1 was actually executed and disagreed.
    const markdown = buildRepoReport(
      detail({
        stats: stats({ behavioralConflicts: 4 }),
        clusters: [
          cluster({ id: 'a', disagreementRisk: 'semantic', hasProvenDivergence: true }),
          cluster({ id: 'b', disagreementRisk: 'semantic', hasProvenDivergence: false }),
        ],
      }),
      options,
    );

    expect(markdown).toContain('| Suspected Conflicts | 4 |');
    expect(markdown).toContain('| Proven by Execution | 1 |');
  });

  it('summarises the same stats the map shows', () => {
    const markdown = buildRepoReport(detail(), options);

    expect(markdown).toContain('| Functions Analyzed | 1,200 |');
    expect(markdown).toContain('| Files | 300 |');
    expect(markdown).toContain('| Semantic Duplicate Clusters | 3 |');
    expect(markdown).toContain('| Near-Duplicate Implementations | 6 |');
    expect(markdown).toContain('| Reusable Utilities Identified | 12 |');
    expect(markdown).toContain('| Suspected Reinvented Utilities | 2 |');
    expect(markdown).toContain('| Lines Removable | ~1,500 |');
    expect(markdown).toContain('| Unifiable Call Sites | 9 |');
  });

  it("lists every cluster in the map's risk order without reordering the input", () => {
    const clusters = [
      cluster({ id: 'a', domain: 'agrees', disagreementRisk: 'none', confidence: 0.95 }),
      cluster({ id: 'b', domain: 'suspected', disagreementRisk: 'semantic' }),
      cluster({ id: 'c', domain: 'cosmetic', disagreementRisk: 'cosmetic', hasProvenDivergence: true }),
      cluster({
        id: 'd',
        domain: 'proven',
        disagreementRisk: 'semantic',
        hasProvenDivergence: true,
        confidence: 0.85,
      }),
    ];

    const rows = clusterRows(buildRepoReport(detail({ clusters }), options)).map(cellsOf);

    expect(rows.map((cells) => cells[0])).toEqual(['1', '2', '3', '4']);
    expect(rows.map((cells) => cells[1])).toEqual([
      '`proven`',
      '`suspected`',
      '`cosmetic`',
      '`agrees`',
    ]);
    expect(clusters.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('renders a cluster row like the cluster list', () => {
    const markdown = buildRepoReport(detail(), options);

    expect(clusterRows(markdown)).toEqual([
      '| 1 | `slugify` | Turn a title into a URL slug | 2 | 0.90 | No disagreement | No |',
    ]);
  });

  it.each([
    { disagreementRisk: 'semantic', hasProvenDivergence: true, confidence: 0.9, verdict: 'Semantic conflict', proven: 'Yes' },
    { disagreementRisk: 'semantic', hasProvenDivergence: false, confidence: 0.9, verdict: 'Suspected conflict', proven: 'No' },
    { disagreementRisk: 'cosmetic', hasProvenDivergence: true, confidence: 0.9, verdict: 'Cosmetic diff', proven: 'Yes' },
    { disagreementRisk: 'none', hasProvenDivergence: false, confidence: 0.9, verdict: 'No disagreement', proven: 'No' },
    { disagreementRisk: 'semantic', hasProvenDivergence: true, confidence: 0.7, verdict: 'Near-duplicate', proven: 'Yes' },
  ] as const)(
    'labels $disagreementRisk risk at $confidence confidence (proven: $hasProvenDivergence) as "$verdict"',
    ({ verdict, proven, ...overrides }) => {
      const [row] = clusterRows(buildRepoReport(detail({ clusters: [cluster(overrides)] }), options));

      expect(cellsOf(row).slice(5)).toEqual([verdict, proven]);
    },
  );

  it('escapes text that would otherwise break the table', () => {
    const markdown = buildRepoReport(
      detail({
        clusters: [
          cluster({
            domain: 'a|b',
            behaviorSummary: 'Splits on "|"\n  and returns Promise<string[]> \\ done',
          }),
        ],
      }),
      options,
    );

    const cells = cellsOf(clusterRows(markdown)[0]);
    expect(cells).toHaveLength(7);
    expect(cells[1]).toBe('`a\\|b`');
    expect(cells[2]).toBe('Splits on "\\|" and returns Promise&lt;string[]> \\\\ done');
  });

  it('falls back to plain text for a domain that contains a backtick', () => {
    const markdown = buildRepoReport(detail({ clusters: [cluster({ domain: 'use`strict' })] }), options);

    expect(cellsOf(clusterRows(markdown)[0])[1]).toBe('use`strict');
  });

  it('says so when the findings come from demo fixtures', () => {
    expect(buildRepoReport(detail(), { ...options, fromFixtures: true })).toContain(
      '> **Demo fixtures.**',
    );
    expect(buildRepoReport(detail(), options)).not.toContain('Demo fixtures');
  });

  it('carries the partial-analysis warning only when the pipeline was capped', () => {
    const capped = stats({ functionsTotal: 2654, functionsAnalyzed: 600 });

    expect(buildRepoReport(detail({ stats: capped }), options)).toContain(
      '> **Partial analysis.** Analysed the first 600 of 2,654 functions',
    );
    // Fully analysed, and the legacy 0/0 "unknown" shape, both stay silent.
    expect(buildRepoReport(detail(), options)).not.toContain('Partial analysis');
    expect(
      buildRepoReport(detail({ stats: stats({ functionsTotal: 0, functionsAnalyzed: 0 }) }), options),
    ).not.toContain('Partial analysis');
  });

  it('says there is nothing to consolidate when there are no clusters', () => {
    const markdown = buildRepoReport(detail({ clusters: [] }), options);

    expect(markdown).toContain('No semantic duplicate clusters found.');
    expect(markdown).not.toContain('| # |');
    expect(clusterRows(markdown)).toHaveLength(0);
  });

  it('is deterministic and ends with exactly one newline', () => {
    const first = buildRepoReport(detail(), options);

    expect(buildRepoReport(detail(), options)).toBe(first);
    expect(first.endsWith('_Generated by Ditto._\n')).toBe(true);
  });

  it('matches the cluster list for every fixture repo', () => {
    for (const { id } of getMockRepos()) {
      const fixture = getMockRepo(id);
      if (!fixture) throw new Error(`fixture ${id} is missing`);

      const rows = clusterRows(buildRepoReport(fixture, options)).map(cellsOf);

      expect(rows).toHaveLength(fixture.clusters.length);
      rows.forEach((cells) => expect(cells).toHaveLength(7));
      expect(rows.filter((cells) => cells[6] === 'Yes')).toHaveLength(
        countProvenDivergences(fixture.clusters),
      );
    }
  });
});
