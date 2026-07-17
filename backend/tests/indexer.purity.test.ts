import { describe, it, expect } from 'vitest';

import { extractFromSource } from '../src/Services/indexer/extract.js';

/**
 * The purity rule, tested against the exact distinction the PRD turns on:
 *   bar external MUTATION and I/O, ALLOW reads of module-level state.
 * Get the "allow reads" half wrong and `currencyToAmount` is dropped and its
 * cluster never surfaces.
 *
 * Bodies are ≥3 lines so the cheap LOC filter does not remove them first.
 */

const purityOf = (source: string): Map<string, boolean> => {
  const { functions } = extractFromSource('src/demo.ts', source);
  return new Map(functions.map((fn) => [fn.name, fn.isPure]));
};

describe('purity — ALLOW reads (the rule the PRD changed)', () => {
  it('treats reading module-level state as pure', () => {
    const purity = purityOf(`
      let config = { sep: ',' };
      export function parseAmount(v: string): number {
        const cleaned = v.split(config.sep).join('');
        return Number(cleaned);
      }
    `);
    expect(purity.get('parseAmount')).toBe(true);
  });

  it('treats calling a same-file pure helper that reads module state as pure', () => {
    // This is the currencyToAmount shape exactly.
    const purity = purityOf(`
      let numberFormat = { thousands: ',' };
      function getFormat(): string {
        const chosen = numberFormat.thousands;
        return chosen || ',';
      }
      export function currencyToAmount(s: string): number {
        const sep = getFormat();
        return Number(s.split(sep).join(''));
      }
    `);
    expect(purity.get('getFormat')).toBe(true);
    expect(purity.get('currencyToAmount')).toBe(true);
  });
});

describe('purity — BAR mutation and I/O', () => {
  it('bars mutating module-level state', () => {
    const purity = purityOf(`
      let counter = 0;
      export function bump(step: number): number {
        counter = counter + step;
        return counter;
      }
    `);
    expect(purity.get('bump')).toBe(false);
  });

  it('bars mutating a parameter the caller can see', () => {
    const purity = purityOf(`
      export function stamp(target: { at?: number }): object {
        target.at = 1;
        return target;
      }
    `);
    expect(purity.get('stamp')).toBe(false);
  });

  it('bars using an imported identifier', () => {
    const purity = purityOf(`
      import { db } from './db';
      export function load(id: string): unknown {
        const row = db.get(id);
        return row;
      }
    `);
    expect(purity.get('load')).toBe(false);
  });

  it('bars I/O, non-determinism, this, and await', () => {
    const purity = purityOf(`
      export function toConsole(m: string): string {
        console.log(m);
        return m;
      }
      export function roll(items: string[]): string {
        const idx = Math.floor(Math.random() * items.length);
        return items[idx];
      }
      export function now(): number {
        const t = Date.now();
        return t;
      }
      export async function wait(x: number): Promise<number> {
        const y = await Promise.resolve(x);
        return y;
      }
      class C {
        v = 1;
        scale(n: number): number {
          const base = this.v;
          return base * n;
        }
      }
    `);
    expect(purity.get('toConsole')).toBe(false);
    expect(purity.get('roll')).toBe(false);
    expect(purity.get('now')).toBe(false);
    expect(purity.get('wait')).toBe(false);
    expect(purity.get('scale')).toBe(false);
  });

  it('propagates impurity through a same-file helper chain', () => {
    const purity = purityOf(`
      import { net } from './net';
      function fetchIt(u: string): unknown {
        const r = net.get(u);
        return r;
      }
      function wrap(u: string): unknown {
        const r = fetchIt(u);
        return r;
      }
      export function outer(u: string): unknown {
        const r = wrap(u);
        return r;
      }
    `);
    expect(purity.get('fetchIt')).toBe(false);
    expect(purity.get('wrap')).toBe(false);
    expect(purity.get('outer')).toBe(false);
  });

  it('marks a function that returns nothing impure — there is nothing to compare', () => {
    const purity = purityOf(`
      export function sideEffectOnly(list: number[]): void {
        const local = list.length;
        const doubled = local * 2;
      }
    `);
    expect(purity.get('sideEffectOnly')).toBe(false);
  });
});

describe('purity — mutating a fresh local is fine', () => {
  it('allows building and mutating a local copy', () => {
    const purity = purityOf(`
      export function sorted(names: string[]): string[] {
        const copy = names.slice();
        copy.sort();
        return copy;
      }
      export function collect(text: string): string[] {
        const out: string[] = [];
        for (const ch of text) { out.push(ch); }
        return out;
      }
    `);
    expect(purity.get('sorted')).toBe(true);
    expect(purity.get('collect')).toBe(true);
  });

  it('bars mutating a local that merely aliases a parameter', () => {
    const purity = purityOf(`
      export function tweak(input: { n: number }): object {
        const ref = input;
        ref.n = 99;
        return ref;
      }
    `);
    expect(purity.get('tweak')).toBe(false);
  });
});

describe('callsExternal is computed independently of the purity verdict', () => {
  it('is true whenever the body uses an import, even for an already-impure function', () => {
    const { functions } = extractFromSource(
      'src/demo.ts',
      `
        import { db } from './db';
        export async function load(id: string): Promise<unknown> {
          const row = await db.find(id);
          return row;
        }
      `
    );
    const load = functions.find((fn) => fn.name === 'load');
    // Impure for several reasons at once; callsExternal must still be true.
    expect(load?.isPure).toBe(false);
    expect(load?.callsExternal).toBe(true);
  });
});
