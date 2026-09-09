import { describe, it, expect } from 'vitest';
import { parseIgnorePatterns, createIgnoreMatcher } from '../src/Services/indexer/ignore.js';

describe('parseIgnorePatterns', () => {
  it('handles empty or undefined input', () => {
    expect(parseIgnorePatterns('')).toEqual([]);
    expect(parseIgnorePatterns(undefined)).toEqual([]);
  });

  it('parses valid glob patterns, ignoring comments and blank lines', () => {
    const raw = `
      # Ignore vendored third-party code
      vendor/**
      shims/*.ts

      # Legacy algorithms
      src/legacy/fast_hash.ts
      *.shim.js
    `;
    const patterns = parseIgnorePatterns(raw);
    expect(patterns).toEqual(['vendor/**', 'shims/*.ts', 'src/legacy/fast_hash.ts', '*.shim.js']);
  });

  it('handles Windows CRLF line endings', () => {
    const raw = 'vendor/**\r\n# comment\r\nsrc/shims.ts\r\n';
    const patterns = parseIgnorePatterns(raw);
    expect(patterns).toEqual(['vendor/**', 'src/shims.ts']);
  });
});

describe('createIgnoreMatcher', () => {
  it('returns false for everything when no patterns are configured', () => {
    const matcher = createIgnoreMatcher([]);
    expect(matcher.isIgnored('src/foo.ts')).toBe(false);
    expect(matcher.isIgnored('vendor/bar.ts')).toBe(false);
  });

  it('matches directory globs and nested files', () => {
    const matcher = createIgnoreMatcher(['vendor/**', 'legacy/*']);
    expect(matcher.isIgnored('vendor/lodash/index.js')).toBe(true);
    expect(matcher.isIgnored('legacy/helper.ts')).toBe(true);
    expect(matcher.isIgnored('src/vendor.ts')).toBe(false);
    expect(matcher.isIgnored('src/legacy/nested/file.ts')).toBe(false);
  });

  it('matches gitignore-style directory patterns with trailing slash', () => {
    const matcher = createIgnoreMatcher(['vendor/']);
    expect(matcher.isIgnored('vendor/lodash/index.js')).toBe(true);
    expect(matcher.isIgnored('vendor/sub/deep/file.ts')).toBe(true);
    expect(matcher.isIgnored('src/vendor/nested.ts')).toBe(true);
  });

  it('matches bare patterns with no slash at any depth (gitignore semantics)', () => {
    const matcher = createIgnoreMatcher(['*.shim.ts', 'secrets.ts']);
    expect(matcher.isIgnored('secrets.ts')).toBe(true);
    expect(matcher.isIgnored('math.shim.ts')).toBe(true);
    expect(matcher.isIgnored('src/secrets.ts')).toBe(true);
    expect(matcher.isIgnored('src/utils/nested/secrets.ts')).toBe(true);
    expect(matcher.isIgnored('src/utils/math.shim.ts')).toBe(true);
    expect(matcher.isIgnored('src/utils/math.ts')).toBe(false);
    expect(matcher.isIgnored('src/not-secrets.ts')).toBe(false);
  });

  it('handles leading slashes and root-anchored patterns', () => {
    const matcher = createIgnoreMatcher(['/root-only.ts', '/vendor/**']);
    expect(matcher.isIgnored('root-only.ts')).toBe(true);
    expect(matcher.isIgnored('src/root-only.ts')).toBe(false);
    expect(matcher.isIgnored('vendor/a.ts')).toBe(true);
    expect(matcher.isIgnored('/vendor/a.ts')).toBe(true);
  });

  it('supports negation patterns', () => {
    const matcher = createIgnoreMatcher(['vendor/**', '!vendor/keep.ts']);
    expect(matcher.isIgnored('vendor/lodash.js')).toBe(true);
    expect(matcher.isIgnored('vendor/keep.ts')).toBe(false);
  });
});
