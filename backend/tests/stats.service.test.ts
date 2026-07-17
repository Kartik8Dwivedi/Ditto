import { describe, it, expect } from 'vitest';

import {
  computeRepoStats,
  healthScore,
  moduleOf,
  CONFIDENCE_THRESHOLD,
  type StatsCluster,
  type StatsFunction,
} from '../src/Services/stats.service.js';

/**
 * The health score goes on screen as one number, so it has to be stable and
 * explainable. These tests pin the properties we would defend out loud.
 */

describe('healthScore', () => {
  it('is 100 for a repo with nothing to report', () => {
    expect(
      healthScore({
        functions: 742,
        semanticDuplicateClusters: 0,
        behavioralConflicts: 0,
        nearDuplicates: 0,
      })
    ).toBe(100);
  });

  it('punishes a behavioural conflict harder than a clean duplicate', () => {
    const base = { functions: 500, nearDuplicates: 0 };
    const conflict = healthScore({ ...base, semanticDuplicateClusters: 1, behavioralConflicts: 1 });
    const duplicate = healthScore({ ...base, semanticDuplicateClusters: 1, behavioralConflicts: 0 });

    expect(conflict).toBeLessThan(duplicate);
    expect(duplicate).toBeLessThan(100);
  });

  it('punishes a clean duplicate harder than a near-duplicate', () => {
    // At the minimum scale so the weight difference (2 vs 1) survives rounding —
    // over a big repo one item of either kind rounds to the same score.
    const base = { functions: 50, semanticDuplicateClusters: 0, behavioralConflicts: 0 };
    const near = healthScore({ ...base, nearDuplicates: 1 });
    const duplicate = healthScore({ functions: 50, semanticDuplicateClusters: 1, behavioralConflicts: 0, nearDuplicates: 0 });

    expect(duplicate).toBeLessThan(near);
    expect(near).toBeLessThan(100);
  });

  it('normalises by repo size — the same debt hurts a small repo more', () => {
    const debt = { semanticDuplicateClusters: 5, behavioralConflicts: 2, nearDuplicates: 3 };
    expect(healthScore({ ...debt, functions: 100 })).toBeLessThan(
      healthScore({ ...debt, functions: 2000 })
    );
  });

  it('never leaves 0-100, however bad the repo is', () => {
    expect(
      healthScore({
        functions: 10,
        semanticDuplicateClusters: 500,
        behavioralConflicts: 500,
        nearDuplicates: 500,
      })
    ).toBe(0);
  });

  it('is total: nonsense input still yields a number in range', () => {
    // Conflicts are a subset of duplicate clusters; a caller claiming more
    // conflicts than clusters must not produce a negative or NaN score.
    const score = healthScore({
      functions: 0,
      semanticDuplicateClusters: 1,
      behavioralConflicts: 99,
      nearDuplicates: -5,
    });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('is deterministic', () => {
    const input = {
      functions: 742,
      semanticDuplicateClusters: 12,
      behavioralConflicts: 5,
      nearDuplicates: 8,
    };
    expect(healthScore(input)).toBe(healthScore(input));
  });
});

describe('moduleOf', () => {
  it('is the directory the file lives in', () => {
    expect(moduleOf('src/common/phone.ts')).toBe('src/common');
    expect(moduleOf('index.ts')).toBe('.');
  });
});

describe('computeRepoStats', () => {
  const functions: StatsFunction[] = [
    { id: 'phone-1', file: 'src/common/phone.ts', loc: 9, isPure: true, isExported: true },
    { id: 'phone-2', file: 'src/checkout/contact.ts', loc: 8, isPure: true, isExported: true },
    { id: 'phone-3', file: 'src/auth/signup.ts', loc: 15, isPure: true, isExported: true },
    { id: 'slugify', file: 'src/utils/text.ts', loc: 7, isPure: true, isExported: true },
    { id: 'helper', file: 'src/utils/text.ts', loc: 4, isPure: true, isExported: false },
  ];

  const confirmed: StatsCluster = {
    functionIds: ['phone-1', 'phone-2', 'phone-3'],
    canonicalId: 'phone-1',
    confidence: 0.94,
    disagreementRisk: 'semantic',
  };

  it('counts files and modules from the function set', () => {
    const stats = computeRepoStats(functions, [confirmed]);
    expect(stats.functions).toBe(5);
    expect(stats.files).toBe(4);
    expect(stats.modules).toBe(4); // common, checkout, auth, utils
  });

  it('counts removable lines as the non-canonical members only', () => {
    const stats = computeRepoStats(functions, [confirmed]);
    expect(stats.linesRemovable).toBe(8 + 15); // phone-2 + phone-3, not phone-1
    expect(stats.callSitesUnifiable).toBe(2);
  });

  it('counts a duplicate in another module as reinvention', () => {
    const stats = computeRepoStats(functions, [confirmed]);
    // phone-2 (checkout) and phone-3 (auth) both live away from the canonical
    // in common — somebody solved this twice rather than copying it once.
    expect(stats.suspectedReinvented).toBe(2);
  });

  it('does not call a same-module duplicate reinvented', () => {
    const sameModule: StatsCluster = {
      functionIds: ['slugify', 'helper'],
      canonicalId: 'slugify',
      confidence: 0.9,
      disagreementRisk: 'none',
    };
    expect(computeRepoStats(functions, [sameModule]).suspectedReinvented).toBe(0);
  });

  it('counts only pure, exported, unclustered functions as reusable utilities', () => {
    const stats = computeRepoStats(functions, [confirmed]);
    // slugify qualifies; helper is not exported; the three phone functions are
    // duplicates, not utilities.
    expect(stats.reusableUtilities).toBe(1);
  });

  it('degrades a low-confidence cluster to a near-duplicate instead of claiming it', () => {
    const unsure: StatsCluster = { ...confirmed, confidence: CONFIDENCE_THRESHOLD - 0.01 };
    const stats = computeRepoStats(functions, [unsure]);

    expect(stats.semanticDuplicateClusters).toBe(0);
    expect(stats.nearDuplicates).toBe(1);
    expect(stats.behavioralConflicts).toBe(0);
    // Nothing is claimed removable on a finding we are not confident about.
    expect(stats.linesRemovable).toBe(0);
  });

  it('counts a semantic-risk cluster as a behavioural conflict', () => {
    const stats = computeRepoStats(functions, [confirmed]);
    expect(stats.semanticDuplicateClusters).toBe(1);
    expect(stats.behavioralConflicts).toBe(1);
    expect(stats.healthScore).toBeLessThan(100);
  });

  it('reports a clean repo as perfectly healthy', () => {
    const stats = computeRepoStats(functions, []);
    expect(stats.healthScore).toBe(100);
    expect(stats.semanticDuplicateClusters).toBe(0);
    expect(stats.reusableUtilities).toBe(4);
  });
});
