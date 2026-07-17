import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';

import ProbeService, {
  buildRows,
  PROBE_TIMEOUT_MS,
  type ProbeCell,
  type ProbeMember,
} from '../src/Services/probe.service.js';
import { ExtractorCacheFileSchema, type ExtractedFunction } from '../src/Models/contracts.js';

/**
 * The divergence table is the product's money shot and the one output that is
 * NOT a model opinion. So this suite really executes the fixture's functions and
 * really checks what came back. Nothing here is mocked.
 */

const loadFixture = async (): Promise<ExtractedFunction[]> => {
  const raw = await readFile(new URL('../.cache/ditto-demo.json', import.meta.url), 'utf8');
  const parsed = ExtractorCacheFileSchema.parse(JSON.parse(raw));
  return Array.isArray(parsed) ? parsed : parsed.functions;
};

const asMembers = (functions: ExtractedFunction[], names: string[]): ProbeMember[] =>
  names.map((name) => {
    const fn = functions.find((candidate) => candidate.name === name);
    if (!fn) throw new Error(`fixture is missing ${name}`);
    return { id: fn.name, body: fn.body, isPure: fn.isPure };
  });

const PHONE_IMPLS = ['normalizePhone', 'formatMobile', 'sanitizeMobile', 'cleanNumber'];

describe('ProbeService.probe — real execution', () => {
  it('proves the four phone normalisers disagree on 00919876543210', async () => {
    const functions = await loadFixture();
    const members = asMembers(functions, PHONE_IMPLS);

    const table = await new ProbeService().probe(members, [
      '["9876543210"]',
      '["00919876543210"]',
      '["+91 98765 43210"]',
      '[""]',
      '[null]',
    ]);

    expect(table).toBeDefined();
    // This ran. It is allowed to say so.
    expect(table!.executed).toBe(true);

    const conflict = table!.rows.find((row) => row.input === '["00919876543210"]');
    expect(conflict).toBeDefined();
    expect(conflict!.diverged).toBe(true);

    const outputs = new Map(conflict!.results.map((r) => [r.functionId, r.output]));
    // Three implementations agree on the ten significant digits...
    expect(outputs.get('normalizePhone')).toBe('"9876543210"');
    expect(outputs.get('formatMobile')).toBe('"9876543210"');
    expect(outputs.get('sanitizeMobile')).toBe('"9876543210"');
    // ...and the fourth keeps the country code. This is the latent bug.
    expect(outputs.get('cleanNumber')).toBe('"919876543210"');
  });

  it('reports agreement on the happy path rather than crying wolf', async () => {
    const functions = await loadFixture();
    const table = await new ProbeService().probe(asMembers(functions, PHONE_IMPLS), [
      '["9876543210"]',
    ]);

    expect(table!.rows[0].diverged).toBe(false);
    for (const result of table!.rows[0].results) {
      expect(result.output).toBe('"9876543210"');
    }
  });

  it('materialises a whole `const f = (x) => ...` statement, not just a bare arrow', async () => {
    const functions = await loadFixture();
    // formatMobile is extracted as a variable statement. If we could not run it
    // it would be silently missing from the table above — so assert it is there.
    const table = await new ProbeService().probe(asMembers(functions, ['formatMobile', 'normalizePhone']), [
      '["9876543210"]',
    ]);

    const ids = table!.rows[0].results.map((r) => r.functionId);
    expect(ids).toContain('formatMobile');
    expect(ids).toContain('normalizePhone');
  });

  it('NEVER executes impure functions', async () => {
    const functions = await loadFixture();
    const members = asMembers(functions, ['saveUser', 'persistUser']);
    expect(members.every((m) => !m.isPure)).toBe(true);

    const table = await new ProbeService().probe(members, ['[{"email":"a@b.c"}]']);

    // No table at all. These touch a database; running them is meaningless and
    // a security hole, so we make no claim about them whatsoever.
    expect(table).toBeUndefined();
  });

  it('will not run a cluster with only one pure member', async () => {
    const functions = await loadFixture();
    const mixed = [...asMembers(functions, ['normalizePhone']), ...asMembers(functions, ['saveUser'])];

    expect(await new ProbeService().probe(mixed, ['["9876543210"]'])).toBeUndefined();
  });

  it('produces no table when the adjudicator gave it no inputs', async () => {
    const functions = await loadFixture();
    expect(await new ProbeService().probe(asMembers(functions, PHONE_IMPLS), [])).toBeUndefined();
  });

  it('records a throw as a divergence signal against a returning implementation', async () => {
    // The PRD's own example: one implementation returns NaN, the other throws.
    // A thrown error IS a divergence signal.
    const table = await new ProbeService().probe(
      [
        { id: 'returns-nan', body: 'function a(x) { return x == null ? NaN : x.length; }', isPure: true },
        { id: 'throws', body: 'function b(x) { return x.length; }', isPure: true },
      ],
      ['[null]']
    );

    expect(table!.executed).toBe(true);
    const row = table!.rows[0];
    expect(row.diverged).toBe(true);

    const byId = new Map(row.results.map((r) => [r.functionId, r]));
    expect(byId.get('returns-nan')!.output).toBe('NaN');
    expect(byId.get('returns-nan')!.error).toBeUndefined();
    expect(byId.get('throws')!.error).toContain('TypeError');
  });

  it('interrupts a function that never returns without losing the whole table', async () => {
    const started = Date.now();
    const table = await new ProbeService().probe(
      [
        { id: 'fine', body: 'function a(x) { return x; }', isPure: true },
        { id: 'wedged', body: 'function b(x) { while (true) {} }', isPure: true },
      ],
      ['[1]']
    );

    // The per-call vm timeout must interrupt the loop. If the call is made from
    // outside runInContext the timeout silently does not apply, the loop runs
    // forever, and the outer worker timeout takes the whole table down with it.
    expect(table).toBeDefined();
    expect(table!.executed).toBe(true);
    expect(Date.now() - started).toBeLessThan(PROBE_TIMEOUT_MS * 3);

    const byId = new Map(table!.rows[0].results.map((r) => [r.functionId, r]));
    expect(byId.get('fine')!.output).toBe('1');
    expect(byId.get('wedged')!.error).toContain('Timeout');
    // Hanging where another implementation returns is a real behavioural
    // difference, not a tooling failure to hide.
    expect(table!.rows[0].diverged).toBe(true);
  }, 20_000);

  it('excludes a function it cannot materialise instead of recording a fake throw', async () => {
    const table = await new ProbeService().probe(
      [
        { id: 'ok-1', body: 'function a(x) { return x * 2; }', isPure: true },
        { id: 'ok-2', body: '(x) => x * 2', isPure: true },
        { id: 'garbage', body: 'this is not a function at all {{{', isPure: true },
      ],
      ['[21]']
    );

    const ids = table!.rows[0].results.map((r) => r.functionId);
    // A tooling failure must never masquerade as a behavioural difference.
    expect(ids).not.toContain('garbage');
    expect(ids.sort()).toEqual(['ok-1', 'ok-2']);
    expect(table!.rows[0].diverged).toBe(false);
  });

  it('makes no claim when too few members survive materialisation', async () => {
    const table = await new ProbeService().probe(
      [
        { id: 'ok', body: 'function a(x) { return x; }', isPure: true },
        { id: 'garbage', body: '}{ nonsense', isPure: true },
      ],
      ['[1]']
    );
    expect(table).toBeUndefined();
  });

  it('cannot reach the filesystem or the network from inside the sandbox', async () => {
    const table = await new ProbeService().probe(
      [
        { id: 'reads-fs', body: 'function a() { return typeof require; }', isPure: true },
        { id: 'reads-net', body: 'function b() { return typeof fetch; }', isPure: true },
        { id: 'reads-proc', body: 'function c() { return typeof process; }', isPure: true },
      ],
      ['[]']
    );

    // Not a policy that blocks these — there is simply no such thing in there.
    for (const result of table!.rows[0].results) {
      expect(result.output).toBe('"undefined"');
    }
  });

  it('executes REAL TypeScript bodies by stripping types first', async () => {
    // Real repo functions carry annotations; the sandbox runs plain JS. If types
    // are not stripped the body fails to parse, the member is excluded, and no
    // hero cluster ever produces a table.
    const table = await new ProbeService().probe(
      [
        { id: 'ts-decl', body: 'function f(text: string, max: number): string { return text.slice(0, max); }', isPure: true },
        { id: 'ts-arrow', body: 'const g = (text: string, max: number): string => text.substring(0, max)', isPure: true },
      ],
      ['["hello world", 5]']
    );

    expect(table).toBeDefined();
    expect(table!.rows[0].results).toHaveLength(2);
    for (const result of table!.rows[0].results) {
      expect(result.output).toBe('"hello"');
    }
    expect(table!.rows[0].diverged).toBe(false);
  });

  it('runs a function that reads module state, via its preamble', async () => {
    // The currencyToAmount case: pure only because it reads module-level config
    // through a same-file helper. Without the preamble it throws ReferenceError
    // in the sandbox; with it, it runs.
    const preamble = `const config = { factor: 100 };\nfunction scale(n: number): number { return n * config.factor; }`;
    const table = await new ProbeService().probe(
      [
        { id: 'with-preamble', body: 'function toMinor(major: number): number { return scale(major); }', isPure: true, preamble },
        { id: 'inline', body: 'function toMinorInline(major: number): number { return major * 100; }', isPure: true },
      ],
      ['[5]', '[2.5]']
    );

    expect(table).toBeDefined();
    expect(table!.executed).toBe(true);
    // Both give the same answer — the preamble made the first one runnable.
    for (const row of table!.rows) {
      expect(row.diverged).toBe(false);
      expect(row.results).toHaveLength(2);
      expect(row.results[0].error).toBeUndefined();
    }
    expect(table!.rows[0].results[0].output).toBe('500');
  });

  it('compares by value, so key order in an object is not a divergence', async () => {
    const table = await new ProbeService().probe(
      [
        { id: 'a', body: '(x) => ({ first: x, second: x })', isPure: true },
        { id: 'b', body: '(x) => ({ second: x, first: x })', isPure: true },
      ],
      ['[1]']
    );

    expect(table!.rows[0].diverged).toBe(false);
  });

  it('distinguishes values JSON alone would flatten', async () => {
    const table = await new ProbeService().probe(
      [
        { id: 'nan', body: '() => NaN', isPure: true },
        { id: 'null', body: '() => null', isPure: true },
      ],
      ['[]']
    );

    const outputs = table!.rows[0].results.map((r) => r.output);
    expect(outputs).toContain('NaN');
    expect(outputs).toContain('null');
    expect(table!.rows[0].diverged).toBe(true);
  });
});

describe('buildRows', () => {
  const cell = (overrides: Partial<ProbeCell> & { functionId: string; key: string }): ProbeCell => ({
    input: '["x"]',
    output: '',
    error: '',
    ...overrides,
  });

  it('marks a row diverged when any two results differ', () => {
    const rows = buildRows([
      cell({ functionId: 'a', key: 'return:"1"', output: '"1"' }),
      cell({ functionId: 'b', key: 'return:"1"', output: '"1"' }),
      cell({ functionId: 'c', key: 'return:"2"', output: '"2"' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].diverged).toBe(true);
    expect(rows[0].results).toHaveLength(3);
  });

  it('agrees when every result matches', () => {
    const rows = buildRows([
      cell({ functionId: 'a', key: 'return:"1"', output: '"1"' }),
      cell({ functionId: 'b', key: 'return:"1"', output: '"1"' }),
    ]);
    expect(rows[0].diverged).toBe(false);
  });

  it('treats a throw and a return as a divergence', () => {
    const rows = buildRows([
      cell({ functionId: 'a', key: 'return:NaN', output: 'NaN' }),
      cell({ functionId: 'b', key: 'throw:TypeError', error: 'TypeError: bad input' }),
    ]);
    expect(rows[0].diverged).toBe(true);
  });

  it('does not call two implementations different because their error wording differs', () => {
    // Both reject bad input with a TypeError. That is agreement, and flagging it
    // would be a false CONFLICT on the one table that must never lie.
    const rows = buildRows([
      cell({ functionId: 'a', key: 'throw:TypeError', error: 'TypeError: expected a string' }),
      cell({ functionId: 'b', key: 'throw:TypeError', error: 'TypeError: input must be text' }),
    ]);
    expect(rows[0].diverged).toBe(false);
  });

  it('does call different error types a divergence', () => {
    const rows = buildRows([
      cell({ functionId: 'a', key: 'throw:TypeError', error: 'TypeError: x' }),
      cell({ functionId: 'b', key: 'throw:RangeError', error: 'RangeError: x' }),
    ]);
    expect(rows[0].diverged).toBe(true);
  });

  it('groups by input and omits the error field when nothing threw', () => {
    const rows = buildRows([
      cell({ functionId: 'a', input: '["x"]', key: 'return:"1"', output: '"1"' }),
      cell({ functionId: 'a', input: '["y"]', key: 'return:"2"', output: '"2"' }),
    ]);

    expect(rows.map((r) => r.input)).toEqual(['["x"]', '["y"]']);
    expect(rows[0].results[0]).not.toHaveProperty('error');
  });
});
