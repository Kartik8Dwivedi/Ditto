import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/Scripts/pipeline.js';

describe('parseArgs', () => {
  it('rejects unknown flags with usage guidance', () => {
    expect(() => parseArgs(['owner/repo', '--bogus'])).toThrow('Unknown flag --bogus');
  });

  it('rejects value flags when their value is another flag', () => {
    expect(() => parseArgs(['owner/repo', '--cache-dir', '--max', '50'])).toThrow(
      '--cache-dir needs a path'
    );
  });

  it('continues to parse valid value and boolean flags', () => {
    expect(parseArgs(['owner/repo', '--cache-dir', 'tmp/cache', '--max', '50', '--json'])).toEqual({
      owner: 'owner',
      name: 'repo',
      cacheDir: 'tmp/cache',
      maxFunctions: 50,
      json: true,
    });
  });
});
