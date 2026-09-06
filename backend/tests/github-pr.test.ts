import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import * as tar from 'tar-stream';

import { afterEach, describe, it, expect, vi } from 'vitest';

import { fetchRepoFiles } from '../src/Services/indexer/github.js';
import HttpGithubPrClient from '../src/Services/pr/github-pr.js';
import { fetchWithRetry } from '../src/Utils/fetchWithRetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('GitHub tarball fetching', () => {
  it('recovers when the first fetch fails transiently', async () => {
    const pack = tar.pack();
    pack.entry({ name: 'example-repo-1234567/README.md' }, 'hello');
    pack.finalize();

    const chunks: Buffer[] = [];
    for await (const chunk of pack) chunks.push(chunk as Buffer);
    const tarball = gzipSync(Buffer.concat(chunks));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(tarball, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const fetched = await fetchRepoFiles({
      owner: 'example',
      name: 'repo',
      branch: 'main',
      accept: () => true,
    });

    expect(fetched.files.get('README.md')).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
  });

  it('retries transient HTTP statuses and honors Retry-After', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry('https://example.test/retry');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors and stops after three transient attempts', async () => {
    const clientErrorFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', clientErrorFetch);

    const notFound = await fetchWithRetry('https://example.test/not-found');

    expect(notFound.status).toBe(404);
    expect(clientErrorFetch).toHaveBeenCalledTimes(1);

    const transientFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '0' } }));
    vi.stubGlobal('fetch', transientFetch);

    const unavailable = await fetchWithRetry('https://example.test/unavailable');

    expect(unavailable.status).toBe(503);
    expect(transientFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithRetry('https://example.test/aborted', { signal: controller.signal })).rejects.toThrow(
      'Aborted'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
