import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * AGENTS.md: "Add every new variable to its schema and backend/.sample.env."
 * That rule is easy to forget (CONFIDENCE_THRESHOLD shipped without a sample
 * entry), so this pins it: every key the env schema declares must appear as a
 * `KEY=` line in .sample.env. Pure file reads: no Mongo, no OpenAI key, no network.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * The keys declared inside `const envSchema = z.object({ ... });`. The body is
 * sliced out first because the frozen export object further down the file has
 * the same two-space `KEY:` shape and includes derived values (IS_PRODUCTION,
 * TASKS_ENABLED) that are correctly absent from .sample.env.
 */
const schemaKeys = (source: string): string[] => {
  const start = source.indexOf('const envSchema = z.object({');
  if (start === -1)
    throw new Error('could not find `const envSchema = z.object({` in AppConfig.ts');
  const end = source.indexOf('\n});', start);
  if (end === -1) throw new Error('could not find the end of envSchema in AppConfig.ts');
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
};

/** Keys set by an uncommented `KEY=` line (a commented-out `# KEY=` does not count). */
const sampleKeys = (source: string): Set<string> =>
  new Set([...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

describe('schemaKeys / sampleKeys extraction', () => {
  it('reads only the envSchema body, not the derived export object', () => {
    const source = [
      'const envSchema = z.object({',
      '  PORT: z.number(),',
      '  MONGO_URI: z.string(),',
      '});',
      'const AppConfig = Object.freeze({',
      '  PORT: env.PORT,',
      '  IS_PRODUCTION: true,',
      '  TASKS_ENABLED: false,',
      '});',
    ].join('\n');
    expect(schemaKeys(source)).toEqual(['PORT', 'MONGO_URI']);
  });

  it('counts uncommented KEY= lines only', () => {
    const keys = sampleKeys('PORT=3001\n# MONGO_URI=x\n  INDENTED=1\nEMPTY=\n');
    expect([...keys].sort()).toEqual(['EMPTY', 'PORT']);
  });
});

describe('backend/.sample.env', () => {
  const schema = schemaKeys(read('../src/Config/AppConfig.ts'));
  const sample = sampleKeys(read('../.sample.env'));

  it('finds the schema keys at all (guards against a silent empty match)', () => {
    expect(schema.length).toBeGreaterThan(10);
    expect(schema).toContain('CONFIDENCE_THRESHOLD');
  });

  it('documents every variable the env schema declares', () => {
    const missing = schema.filter((key) => !sample.has(key));
    expect(
      missing,
      `backend/.sample.env is missing: ${missing.join(', ')}. ` +
        'Add a KEY= line with a comment block (AGENTS.md: every new variable goes in the schema AND .sample.env).'
    ).toEqual([]);
  });
});
