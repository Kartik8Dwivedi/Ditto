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

  it('matches extension patterns and file basenames', () => {
    const matcher = createIgnoreMatcher(['**/*.shim.ts', 'src/generated/*.ts']);
    expect(matcher.isIgnored('src/utils/math.shim.ts')).toBe(true);
    expect(matcher.isIgnored('src/generated/types.ts')).toBe(true);
    expect(matcher.isIgnored('src/utils/math.ts')).toBe(false);
  });

  it('handles leading slashes gracefully', () => {
    const matcher = createIgnoreMatcher(['/vendor/**', '/shims/*.ts']);
    expect(matcher.isIgnored('vendor/a.ts')).toBe(true);
    expect(matcher.isIgnored('shims/b.ts')).toBe(true);
    expect(matcher.isIgnored('/vendor/a.ts')).toBe(true);
  });
});
