import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  addedRanges,
  overlaps,
  changedSourceRanges,
  selectChangedFunctions,
  type PrFile,
} from '../src/Services/pr/diff.js';

/**
 * The diff math is the pure core of "which functions did this PR touch". It runs
 * against a REAL cached PR fixture (no live GitHub) plus controlled synthetic
 * patches so the exact line arithmetic is pinned.
 */

const FIXTURE = (name: string): PrFile[] =>
  JSON.parse(
    readFileSync(path.resolve('.cache/pr-probe', name), 'utf8')
  ) as PrFile[];

describe('addedRanges', () => {
  it('parses added line runs from a unified-diff hunk header', () => {
    // Hunk starts at new-file line 10; two context, two added, one context.
    const patch = ['@@ -8,4 +10,6 @@', ' ctx', ' ctx', '+added-a', '+added-b', ' ctx'].join('\n');
    // new lines: 10 ctx, 11 ctx, 12 added, 13 added, 14 ctx → added run [12,13].
    expect(addedRanges(patch)).toEqual([[12, 13]]);
  });

  it('splits added runs across removed/context lines and multiple hunks', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      '+a', // line 1
      ' ctx', // line 2
      '+b', // line 3
      '@@ -20,1 +30,2 @@',
      '-gone',
      '+c', // line 30
    ].join('\n');
    expect(addedRanges(patch)).toEqual([
      [1, 1],
      [3, 3],
      [30, 30],
    ]);
  });

  it('returns nothing for an absent patch', () => {
    expect(addedRanges(undefined)).toEqual([]);
  });

  it('produces sane ranges from a real cached PR patch', () => {
    const files = FIXTURE('cline-cline-pr-12387-files.json');
    const withPatch = files.find((f) => f.patch && f.status !== 'removed');
    expect(withPatch).toBeDefined();
    const ranges = addedRanges(withPatch!.patch);
    expect(ranges.length).toBeGreaterThan(0);
    // Every range is a valid, forward interval.
    for (const [start, end] of ranges) {
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThanOrEqual(start);
    }
  });
});

describe('overlaps', () => {
  it('is true for touching/overlapping intervals and false otherwise', () => {
    expect(overlaps([1, 5], [5, 9])).toBe(true);
    expect(overlaps([1, 5], [6, 9])).toBe(false);
    expect(overlaps([10, 20], [12, 15])).toBe(true);
  });
});

describe('changedSourceRanges', () => {
  it('keeps source files and drops tests/non-source from a real PR fixture', () => {
    const files = FIXTURE('cline-cline-pr-12387-files.json');
    const map = changedSourceRanges(files);
    const keys = [...map.keys()];

    // At least one real .ts source survived.
    expect(keys.some((k) => k.endsWith('.ts') && !k.endsWith('.test.ts'))).toBe(true);
    // Test files are excluded — a duplicated test helper is not a finding.
    expect(keys.some((k) => k.endsWith('.test.ts'))).toBe(false);
  });
});

describe('selectChangedFunctions', () => {
  const SOURCE = [
    '// header',
    'export function alpha(a) {',
    '  return a + 1;',
    '}',
    '',
    'export function beta(b, c) {',
    '  return b * c;',
    '}',
    '',
    'export function gamma(x) {',
    '  return x - 1;',
    '}',
  ].join('\n');

  it('keeps ONLY functions whose lines overlap an added range', () => {
    // beta spans lines 6-8; only touch line 7.
    const selected = selectChangedFunctions([
      { file: 'src/util/math.ts', contents: SOURCE, ranges: [[7, 7]] },
    ]);
    expect(selected.map((f) => f.name)).toEqual(['beta']);
  });

  it('keeps multiple functions when ranges span them', () => {
    const selected = selectChangedFunctions([
      { file: 'src/util/math.ts', contents: SOURCE, ranges: [[2, 3], [10, 11]] },
    ]);
    expect(selected.map((f) => f.name).sort()).toEqual(['alpha', 'gamma']);
  });

  it('returns nothing when no function overlaps the added lines', () => {
    const selected = selectChangedFunctions([
      { file: 'src/util/math.ts', contents: SOURCE, ranges: [[1, 1]] },
    ]);
    expect(selected).toEqual([]);
  });
});
