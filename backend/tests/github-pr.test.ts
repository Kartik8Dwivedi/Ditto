import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as tar from 'tar-stream';

import { afterEach, describe, it, expect, vi } from 'vitest';

import logger from '../src/Config/logger.js';
import { fetchRepoFiles } from '../src/Services/indexer/github.js';
import HttpGithubPrClient, { parseNextLink } from '../src/Services/pr/github-pr.js';
import { fetchWithRetry } from '../src/Utils/fetchWithRetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseNextLink', () => {
  it('extracts next URL from a standard quoted Link header', () => {
    const header = '<https://api.github.com/repos/o/r/pulls/1/files?page=2>; rel="next"';
    expect(parseNextLink(header)).toBe('https://api.github.com/repos/o/r/pulls/1/files?page=2');
  });

  it('extracts next URL when multiple links (prev, next, last) are present', () => {
    const header =
      '<https://api.github.com/repos/o/r/pulls/1/files?page=1>; rel="prev", ' +
      '<https://api.github.com/repos/o/r/pulls/1/files?page=3>; rel="next", ' +
      '<https://api.github.com/repos/o/r/pulls/1/files?page=5>; rel="last"';
    expect(parseNextLink(header)).toBe('https://api.github.com/repos/o/r/pulls/1/files?page=3');
  });

  it('handles unquoted rel=next and case-insensitivity', () => {
    const header = '<https://api.github.com/repos/o/r/pulls/1/files?page=2>; REL=next';
    expect(parseNextLink(header)).toBe('https://api.github.com/repos/o/r/pulls/1/files?page=2');
  });

  it('returns null when rel="next" is not present', () => {
    const header = '<https://api.github.com/repos/o/r/pulls/1/files?page=1>; rel="prev"';
    expect(parseNextLink(header)).toBeNull();
  });

  it('returns null for null, undefined, or empty headers', () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink(undefined)).toBeNull();
    expect(parseNextLink('')).toBeNull();
  });
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
  const client = new HttpGithubPrClient(
    fileURLToPath(new URL('./fixtures/pr-probe/', import.meta.url))
  );

  it('serves cached PR changed-files with NO token (fixtures need no GITHUB_TOKEN)', async () => {
    const files = await client.getChangedFiles('cline', 'cline', 12068);
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
    expect(files.truncated).toBe(false);
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

  it('turns a stalled LIVE fetch into an actionable gateway-timeout error', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'ditto-github-pr-'));
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const liveClient = new HttpGithubPrClient(cacheDir, 'test-token');
      const request = liveClient.getChangedFiles('example', 'repo', 42);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

      controller.abort(new DOMException('Timed out', 'TimeoutError'));

      await expect(request).rejects.toMatchObject({
        statusCode: 504,
        message: expect.stringMatching(/GitHub request timed out after 30000ms.*Retry/),
      });
      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('follows Link rel="next" to accumulate and merge files across pages and caches the merged array', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'ditto-github-pr-pagination-'));
    const page1Files = [
      { sha: 'sha1', filename: 'file1.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const page2Files = [
      { sha: 'sha2', filename: 'file2.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ];

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('page=2')) {
        return new Response(JSON.stringify(page2Files), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(page1Files), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          Link: '<https://api.github.com/repos/example/repo/pulls/42/files?per_page=100&page=2>; rel="next"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const liveClient = new HttpGithubPrClient(cacheDir, 'test-token');
      const files = await liveClient.getChangedFiles('example', 'repo', 42);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.filename)).toEqual(['file1.ts', 'file2.ts']);
      expect(files.truncated).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify the merged array was cached on disk: second call with no token and no network succeeds
      fetchMock.mockClear();
      const cachedClient = new HttpGithubPrClient(cacheDir, undefined);
      const cachedFiles = await cachedClient.getChangedFiles('example', 'repo', 42);
      expect(cachedFiles).toHaveLength(2);
      expect(cachedFiles.map((f) => f.filename)).toEqual(['file1.ts', 'file2.ts']);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('caps pagination at maxPages, sets truncated flag, and logs a structured warning', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'ditto-github-pr-truncation-'));
    const warnSpy = vi.spyOn(logger, 'warn');
    const pageFiles = [
      { sha: 'sha1', filename: 'file1.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(JSON.stringify(pageFiles), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          Link: '<https://api.github.com/repos/example/repo/pulls/42/files?per_page=100&page=2>; rel="next"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      // With maxPages = 1, it should stop after page 1 even though next link exists
      const liveClient = new HttpGithubPrClient(cacheDir, 'test-token', 1);
      const files = await liveClient.getChangedFiles('example', 'repo', 42);

      expect(files).toHaveLength(1);
      expect(files.truncated).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/PR #42 for example\/repo.*truncated.*max page limit/)
      );
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('returns single page without truncation when no next Link header is present', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'ditto-github-pr-single-'));
    const pageFiles = [
      { sha: 'sha1', filename: 'file1.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(pageFiles), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const liveClient = new HttpGithubPrClient(cacheDir, 'test-token');
      const files = await liveClient.getChangedFiles('example', 'repo', 42);

      expect(files).toHaveLength(1);
      expect(files.truncated).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
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
    const clientErrorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry('https://example.test/aborted', { signal: controller.signal })
    ).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
