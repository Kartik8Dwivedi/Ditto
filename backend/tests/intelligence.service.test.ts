import { describe, it, expect, vi } from 'vitest';

import IntelligenceService from '../src/Services/intelligence.service.js';

/**
 * GET /repos/:id is the landing page's data source, so its cost matters as much
 * as its output.
 *
 * It once loaded every function in the repo — 2654 documents for cline, each
 * carrying a full source body and a 1536-float embedding — purely to read one
 * integer off each. That was ~30MB and ~6.5s. These tests pin BOTH the payload
 * and the access pattern, because the payload alone stays correct even if the
 * expensive query comes back.
 */

const objectId = (id: string) => ({ toString: () => id });

const cluster = (id: string, memberIds: string[], canonicalId: string) => ({
  _id: objectId(id),
  functionIds: memberIds.map(objectId),
  canonicalId: objectId(canonicalId),
  domain: 'text',
  behaviorSummary: 'truncate a string',
  confidence: 0.9,
  disagreementRisk: 'semantic',
  differences: [],
  divergence: { executed: true, rows: [{ input: '["a",1]', results: [], diverged: true }] },
});

const makeService = (opts: { clusters: unknown[]; locs: Array<{ _id: unknown; loc: number }> }) => {
  const findByRepo = vi.fn().mockResolvedValue([]);
  const findLocsByIds = vi.fn().mockResolvedValue(opts.locs);
  const service = new IntelligenceService({
    repoRepository: {
      findByIdOrFail: vi.fn().mockResolvedValue({
        _id: objectId('repo-1'),
        owner: 'cline',
        name: 'cline',
        commit: 'abc1234',
        indexedAt: new Date('2026-07-18T00:00:00Z'),
        stats: { functions: 2654, linesRemovable: 859 },
      }),
    } as never,
    functionRepository: { findByRepo, findLocsByIds } as never,
    clusterRepository: { findByRepo: vi.fn().mockResolvedValue(opts.clusters) } as never,
  });
  return { service, findByRepo, findLocsByIds };
};

describe('IntelligenceService.getRepoDetail', () => {
  const clusters = [cluster('c1', ['f1', 'f2'], 'f1'), cluster('c2', ['f3', 'f4'], 'f3')];
  const locs = [
    { _id: objectId('f1'), loc: 10 },
    { _id: objectId('f2'), loc: 7 },
    { _id: objectId('f3'), loc: 20 },
    { _id: objectId('f4'), loc: 5 },
  ];

  it('counts removable lines as the non-canonical members', async () => {
    const { service } = makeService({ clusters, locs });
    const detail = await service.getRepoDetail('repo-1');

    // c1 keeps f1 (10) and drops f2 (7); c2 keeps f3 (20) and drops f4 (5).
    expect(detail.clusters.map((c) => c.linesRemovable)).toEqual([7, 5]);
    expect(detail.clusters[0].hasProvenDivergence).toBe(true);
  });

  it('never loads the repo-wide function set (the ~6.5s query)', async () => {
    const { service, findByRepo } = makeService({ clusters, locs });
    await service.getRepoDetail('repo-1');
    expect(findByRepo).not.toHaveBeenCalled();
  });

  it('asks only for the line counts of cluster MEMBERS', async () => {
    const { service, findLocsByIds } = makeService({ clusters, locs });
    await service.getRepoDetail('repo-1');

    // Scales with findings, not with repo size.
    const requested = findLocsByIds.mock.calls[0][0] as string[];
    expect([...requested].sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('serves stats straight off the repo document, with no extra query', async () => {
    const { service } = makeService({ clusters, locs });
    const detail = await service.getRepoDetail('repo-1');
    expect(detail.stats).toMatchObject({ functions: 2654, linesRemovable: 859 });
  });

  it('handles a repo with no clusters without querying for locs', async () => {
    const { service, findLocsByIds } = makeService({ clusters: [], locs: [] });
    const detail = await service.getRepoDetail('repo-1');

    expect(detail.clusters).toEqual([]);
    expect(findLocsByIds).toHaveBeenCalledWith([]);
  });
});
