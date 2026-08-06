import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StatusCodes } from 'http-status-codes';

import AppConfig from '../../Config/AppConfig.js';
import logger from '../../Config/logger.js';
import AppError from '../../Utils/errors/AppError.js';
import type { PrFile } from './diff.js';

/**
 * GITHUB PULL-REQUEST REST client — list/resolve a PR and its changed files.
 *
 * Lifted from Scripts/pr-feasibility.ts: token-aware, and every response is
 * disk-cached under `backend/.cache/pr-probe/` so a re-check (or a test) costs
 * no rate limit and no network. Unlike the tarball path in indexer/github.ts,
 * these REST endpoints have NO codeload fallback, so a token matters here (Stage
 * B makes it required); anonymous callers get GitHub's shared 60/hr.
 */

/** `backend/.cache/pr-probe/` — resolves the same under tsx and dist. */
export const PR_CACHE_DIR = fileURLToPath(new URL('../../../.cache/pr-probe/', import.meta.url));

/** The subset of GitHub's PR object we use. */
interface RawPull {
  number: number;
  state: string;
  title: string;
  html_url: string;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
}

/** Everything the PR path needs to identify what code a PR proposes. */
export interface PullMeta {
  prNumber: number;
  headSha: string;
  baseSha: string;
  headRef: string;
  prUrl: string;
}

/** The narrow surface PrService depends on, so tests can inject a fake. */
export interface GithubPrClient {
  resolvePull(owner: string, name: string, prNumber?: number): Promise<PullMeta>;
  getChangedFiles(owner: string, name: string, prNumber: number): Promise<PrFile[]>;
}

const toMeta = (pull: RawPull): PullMeta => ({
  prNumber: pull.number,
  headSha: pull.head.sha,
  baseSha: pull.base.sha,
  headRef: pull.head.ref,
  prUrl: pull.html_url,
});

/** The real, network-and-cache-backed client. */
export class HttpGithubPrClient implements GithubPrClient {
  constructor(private readonly cacheDir: string = PR_CACHE_DIR) {}

  /**
   * GET with a disk cache keyed by a caller-supplied slug. A cache hit is
   * returned verbatim; a miss fetches, then writes the response for next time.
   */
  private async get<T>(url: string, cacheKey: string): Promise<T | null> {
    const file = path.join(this.cacheDir, `${cacheKey}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      /* not cached yet */
    }

    // A LIVE fetch is about to happen (nothing cached). The PR REST endpoints
    // have NO codeload fallback, and anonymous is GitHub's 60/hr shared across
    // Cloud Run's NAT IP — effectively unusable in production. So Stage B makes a
    // token REQUIRED here, failing with an actionable message instead of a
    // mystery 403/rate-limit later. Cache HITS never reach this line, so the
    // pr-probe fixtures (and the tests that use them) need no token.
    if (!AppConfig.GITHUB_TOKEN) {
      throw new AppError(
        'A GITHUB_TOKEN is required to fetch pull-request data from GitHub. ' +
          'Set GITHUB_TOKEN in the environment (a fine-grained token with public-repo read access is enough) and retry.',
        StatusCodes.SERVICE_UNAVAILABLE
      );
    }

    const headers: Record<string, string> = {
      'user-agent': 'ditto-pr-agent',
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${AppConfig.GITHUB_TOKEN}`,
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      logger.warn(
        `github ${res.status} for ${url} (ratelimit remaining: ${res.headers.get('x-ratelimit-remaining')})`
      );
      return null;
    }
    const json = (await res.json()) as T;
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(json));
    return json;
  }

  async resolvePull(owner: string, name: string, prNumber?: number): Promise<PullMeta> {
    const slug = `${owner}/${name}`;

    if (prNumber !== undefined) {
      const pull = await this.get<RawPull>(
        `https://api.github.com/repos/${slug}/pulls/${prNumber}`,
        `${owner}-${name}-pr-${prNumber}`
      );
      if (!pull) {
        throw new AppError(
          `Could not fetch PR #${prNumber} for ${slug} from GitHub (rate limited, or it does not exist). Set GITHUB_TOKEN to raise the limit.`,
          StatusCodes.BAD_GATEWAY
        );
      }
      return toMeta(pull);
    }

    // No number given → the latest OPEN PR (most recently updated).
    const pulls = await this.get<RawPull[]>(
      `https://api.github.com/repos/${slug}/pulls?state=open&per_page=10&sort=updated&direction=desc`,
      `${owner}-${name}-pulls`
    );
    if (!pulls) {
      throw new AppError(
        `Could not list open PRs for ${slug} from GitHub (rate limited?). Set GITHUB_TOKEN to raise the limit.`,
        StatusCodes.BAD_GATEWAY
      );
    }
    const open = pulls.find((pull) => pull.state === 'open') ?? pulls[0];
    if (!open) {
      throw new AppError(`${slug} has no open pull requests to check.`, StatusCodes.NOT_FOUND);
    }
    return toMeta(open);
  }

  async getChangedFiles(owner: string, name: string, prNumber: number): Promise<PrFile[]> {
    const files = await this.get<PrFile[]>(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/files?per_page=100`,
      `${owner}-${name}-pr-${prNumber}-files`
    );
    if (!files) {
      throw new AppError(
        `Could not fetch changed files for ${owner}/${name} PR #${prNumber} from GitHub. Set GITHUB_TOKEN to raise the limit.`,
        StatusCodes.BAD_GATEWAY
      );
    }
    return files;
  }
}

export default HttpGithubPrClient;
