import { isAnySourceFile, adapterFor } from '../indexer/language/registry.js';
import type { ExtractedFunction } from '../../Models/contracts.js';

/**
 * DIFF MATH — the pure, unit-testable core of "which functions did this PR touch".
 *
 * Lifted out of Scripts/pr-feasibility.ts so both the diagnostic script and the
 * live /pr path compute added ranges the exact same way. No I/O, no GitHub, no
 * LLM — just a unified-diff parser and a range-overlap test.
 */

/** A changed file as GitHub's `/pulls/:n/files` reports it. */
export interface PrFile {
  filename: string;
  status: string;
  additions?: number;
  /** Unified-diff hunk text. Absent for very large or binary files. */
  patch?: string;
}

/** A half-open-free inclusive line range `[start, end]` in the NEW file. */
export type LineRange = [number, number];

/**
 * Added line ranges in the NEW file, parsed from unified-diff hunk headers.
 *
 * Walks the `+`/`-`/context lines of each hunk, tracking the new-file line
 * counter, and coalesces consecutive added lines into `[start, end]` runs. A
 * `-` or context line flushes the current run, so a range only ever covers lines
 * this PR actually added.
 */
export const addedRanges = (patch?: string): LineRange[] => {
  if (!patch) return [];
  const ranges: LineRange[] = [];
  let newLine = 0;
  let runStart = 0;
  let runEnd = 0;
  const flush = (): void => {
    if (runStart) ranges.push([runStart, runEnd]);
    runStart = 0;
  };

  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+')) {
      if (!runStart) runStart = newLine;
      runEnd = newLine;
      newLine += 1;
    } else if (line.startsWith('-')) {
      flush();
    } else {
      flush();
      newLine += 1;
    }
  }
  flush();
  return ranges;
};

/** Do two inclusive line ranges overlap? */
export const overlaps = (a: LineRange, b: LineRange): boolean => a[0] <= b[1] && b[0] <= a[1];

/**
 * The added line ranges of every changed SOURCE file, keyed by path.
 *
 * Non-source files (tests, generated, non-.ts/.js) are dropped here so we never
 * fetch or parse them. A file with no parseable added ranges is omitted.
 */
export const changedSourceRanges = (files: PrFile[]): Map<string, LineRange[]> => {
  const byFile = new Map<string, LineRange[]>();
  for (const file of files) {
    if (file.status === 'removed') continue;
    if (!isAnySourceFile(file.filename)) continue;
    const ranges = addedRanges(file.patch);
    if (ranges.length > 0) byFile.set(file.filename, ranges);
  }
  return byFile;
};

/** One file's PR-head contents plus the ranges this PR added to it. */
export interface ChangedFileInput {
  file: string;
  contents: string;
  ranges: LineRange[];
}

/**
 * The PR's changed functions: extract every function from each PR-HEAD file and
 * keep only those whose `[startLine, endLine]` overlaps an added range.
 *
 * These are real `ExtractedFunction`s — WITH preamble and purity — so the ones
 * that survive can be fingerprinted, matched, and (when pure) executed.
 */
export const selectChangedFunctions = (inputs: ChangedFileInput[]): ExtractedFunction[] => {
  const changed: ExtractedFunction[] = [];
  for (const { file, contents, ranges } of inputs) {
    if (ranges.length === 0) continue;
    const adapter = adapterFor(file);
    if (!adapter) continue;
    const { functions } = adapter.extract(file, contents);
    for (const fn of functions) {
      if (ranges.some((range) => overlaps(range, [fn.startLine, fn.endLine]))) {
        changed.push(fn);
      }
    }
  }
  return changed;
};
