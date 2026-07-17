import { describe, it, expect } from 'vitest';

import { extractFromSource } from '../src/Services/indexer/extract.js';

/**
 * The preamble is what lets a "pure because it reads module state" function
 * actually execute. It must gather every same-file dependency, transitively, and
 * decline entirely when a dependency reaches outside the file.
 *
 * Bodies are ≥3 lines so the cheap LOC filter does not remove them first.
 */

const preambleOf = (source: string, name: string): string | undefined =>
  extractFromSource('src/demo.ts', source).functions.find((fn) => fn.name === name)?.preamble;

describe('execution preamble', () => {
  it('includes a module-level constant the function reads', () => {
    const preamble = preambleOf(
      `
        const RATE = 100;
        export function toMinor(major: number): number {
          const scaled = major * RATE;
          return scaled;
        }
      `,
      'toMinor'
    );
    expect(preamble).toContain('RATE');
    expect(preamble).toContain('100');
  });

  it('includes a same-file helper AND the state that helper reads', () => {
    const preamble = preambleOf(
      `
        let numberFormat = { thousands: ',' };
        function getSep(): string {
          const sep = numberFormat.thousands;
          return sep || ',';
        }
        export function parse(s: string): number {
          const cleaned = s.split(getSep()).join('');
          return Number(cleaned);
        }
      `,
      'parse'
    );
    expect(preamble).toContain('getSep');
    expect(preamble).toContain('numberFormat'); // pulled in transitively
  });

  it('is absent for a self-contained function', () => {
    expect(
      preambleOf(
        `export function double(n: number): number {
          const sum = n + n;
          return sum;
        }`,
        'double'
      )
    ).toBeUndefined();
  });

  it('declines (undefined) when a dependency reaches an import', () => {
    // The helper touches an import, so no runnable preamble can be built. Better
    // to ship none — the prober then makes no claim — than a broken one.
    const preamble = preambleOf(
      `
        import { locale } from './i18n';
        function getSep(): string {
          const sep = locale.sep;
          return sep || ',';
        }
        export function parse(s: string): number {
          const cleaned = s.split(getSep()).join('');
          return Number(cleaned);
        }
      `,
      'parse'
    );
    expect(preamble).toBeUndefined();
  });

  it('does not put export keywords in the preamble', () => {
    const preamble = preambleOf(
      `
        export const RATE = 100;
        export function scale(n: number): number {
          const scaled = n * RATE;
          return scaled;
        }
      `,
      'scale'
    );
    expect(preamble).toBeDefined();
    expect(preamble).not.toMatch(/\bexport\b/);
  });
});
