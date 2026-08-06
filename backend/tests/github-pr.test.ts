import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import HttpGithubPrClient from '../src/Services/pr/github-pr.js';

/**
 * The GitHub PR REST client, and Stage B's token rule.
 *
 * The PR endpoints (/pulls, /pulls/:n/files) have NO codeload fallback and
 * anonymous is 60/hr shared across Cloud Run's NAT IP, so Stage B REQUIRES a
 * GITHUB_TOKEN for any LIVE fetch and fails fast with an actionable message
 * otherwise. Crucially, a cache HIT never reaches that check — so the cached
 * .cache/pr-probe fixtures (and every test here) need no token, and the test env
 * sets none.
 */
describe('HttpGithubPrClient', () => {
  // Read from the tracked test fixtures, not the gitignored .cache, so the suite
  // is hermetic in CI (no token, no network — a cache HIT never needs a token).
  const client = new HttpGithubPrClient(fileURLToPath(new URL('./fixtures/pr-probe/', import.meta.url)));

  it('serves cached PR changed-files with NO token (fixtures need no GITHUB_TOKEN)', async () => {
    const files = await client.getChangedFiles('cline', 'cline', 12068);
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it('resolves the latest open PR from the cached listing with NO token', async () => {
    const meta = await client.resolvePull('cline', 'cline');
    expect(meta.prNumber).toBeGreaterThan(0);
    expect(typeof meta.headSha).toBe('string');
    expect(meta.headSha.length).toBeGreaterThan(0);
  });

  it('fails with a clear, actionable error when a LIVE fetch is needed but no token is set', async () => {
    // 999999 is not cached → a live fetch is required → refused (no network hit),
    // with a message that names GITHUB_TOKEN and what to do about it.
    await expect(client.getChangedFiles('cline', 'cline', 999999)).rejects.toThrow(
      /GITHUB_TOKEN is required/
    );
  });
});
