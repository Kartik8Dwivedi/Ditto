import { describe, it, expect } from 'vitest';

import { extractFromSource, hashBody } from '../src/Services/indexer/extract.js';
import { isSourceFile, skipReason } from '../src/Services/indexer/filter.js';

/**
 * The extractor's one non-negotiable: find EVERY function, exported or not.
 * Our demo target has four `truncateText` and three are file-private — miss them
 * and the cluster never forms.
 *
 * Test bodies are deliberately ≥3 lines: the cheap filters drop one-liners, so a
 * one-line fixture would be testing the filter, not the walk.
 */

const byName = (source: string, name: string) =>
  extractFromSource('src/demo.ts', source).functions.filter((fn) => fn.name === name);

describe('extractFromSource — finds every function', () => {
  it('finds non-exported functions, not just exported ones', () => {
    const source = `
      export function alpha(a: string) {
        const trimmed = a.trim();
        return trimmed.toLowerCase();
      }
      function bravo(b: string) {
        const trimmed = b.trim();
        return trimmed.toUpperCase();
      }
      const charlie = (c: string) => {
        const trimmed = c.trim();
        return trimmed.length;
      };
    `;
    const names = extractFromSource('src/demo.ts', source).functions.map((fn) => fn.name).sort();
    expect(names).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('finds four same-named functions across one file, marking export state', () => {
    // A miniature of the cline `truncateText` case: same name, different scopes.
    const source = `
      export function truncateText(t: string, n: number): string {
        if (t.length <= n) return t;
        return t.slice(0, n);
      }
      function truncateText2(t: string, n: number): string {
        if (t.length <= n) return t;
        return t.substring(0, n) + '...';
      }
      const helper = {
        truncateText(t: string, n: number) {
          const limit = Math.max(0, n);
          return t.slice(0, limit);
        },
      };
      class Box {
        truncateText(t: string, n: number): string {
          const cut = t.slice(0, n);
          return cut.trimEnd();
        }
      }
    `;
    const fns = extractFromSource('src/demo.ts', source).functions;
    const truncators = fns.filter((fn) => fn.name.startsWith('truncateText'));
    expect(truncators.length).toBeGreaterThanOrEqual(3);
    expect(fns.find((fn) => fn.name === 'truncateText')?.isExported).toBe(true);
  });

  it('finds class methods, including private ones', () => {
    const source = `
      class Service {
        public format(x: string): string {
          const trimmed = x.trim();
          return trimmed;
        }
        private normalise(x: string): string {
          const lowered = x.toLowerCase();
          return lowered.trim();
        }
      }
    `;
    const names = extractFromSource('src/service.ts', source).functions.map((fn) => fn.name).sort();
    expect(names).toEqual(['format', 'normalise']);
  });

  it('records the pinned ExtractedFunction shape', () => {
    const [fn] = byName(
      `export function trim(s: string): string {
        const lowered = s.toLowerCase();
        return lowered.trim();
      }`,
      'trim'
    );
    expect(fn).toMatchObject({
      name: 'trim',
      file: 'src/demo.ts',
      isExported: true,
      params: ['s'],
      returnTypeText: 'string',
      isPure: true,
    });
    expect(fn.bodyHash).toBe(hashBody(fn.body));
    expect(fn.loc).toBeGreaterThanOrEqual(3);
  });

  it('drops trivial functions with a stated reason, never silently', () => {
    const source = `
      export const id = (x: unknown) => x;
      function wrap(a: string) { return other(a); }
      export function real(a: string) {
        const parts = a.split(',');
        const trimmed = parts.map((p) => p.trim());
        return trimmed.join('|');
      }
    `;
    const { functions, skipped } = extractFromSource('src/demo.ts', source);
    expect(functions.map((fn) => fn.name)).toContain('real');
    expect(functions.map((fn) => fn.name)).not.toContain('id');
    expect(skipped.length).toBeGreaterThan(0);
    for (const entry of skipped) expect(entry.reason).toBeTruthy();
  });

  it('captures the file imports on every function', () => {
    const source = `
      import { db } from './db';
      import type { T } from './types';
      export function q(id: string) {
        const key = id.trim();
        return key.length;
      }
    `;
    const [fn] = byName(source, 'q');
    expect(fn.imports).toContain('./db');
  });
});

describe('isSourceFile', () => {
  it('keeps hand-written source', () => {
    expect(isSourceFile('src/utils/phone.ts')).toBe(true);
    expect(isSourceFile('packages/core/index.tsx')).toBe(true);
    expect(isSourceFile('lib/format.js')).toBe(true);
  });

  it('drops vendored, generated, and test files', () => {
    expect(isSourceFile('node_modules/x/index.js')).toBe(false);
    expect(isSourceFile('dist/bundle.js')).toBe(false);
    expect(isSourceFile('src/foo.min.js')).toBe(false);
    expect(isSourceFile('src/types.d.ts')).toBe(false);
    expect(isSourceFile('src/phone.test.ts')).toBe(false);
    expect(isSourceFile('src/__tests__/phone.ts')).toBe(false);
    expect(isSourceFile('package-lock.json')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });
});

describe('skipReason', () => {
  it('flags accessors, tiny functions, and wrappers', () => {
    expect(skipReason({ name: 'x', loc: 1, body: 'get x() { return 1; }', isAccessor: true })).toBe('getter/setter');
    expect(skipReason({ name: 'x', loc: 1, body: '() => 1', isAccessor: false })).toContain('lines');
    expect(skipReason({ name: 'w', loc: 3, body: '(a) => other(a)', isAccessor: false })).toBe('trivial wrapper');
  });

  it('keeps a function with real logic', () => {
    const body = 'function f(a) {\n  const b = a.split(",");\n  return b.length;\n}';
    expect(skipReason({ name: 'f', loc: 4, body, isAccessor: false })).toBeNull();
  });
});
