import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { StatusCodes } from 'http-status-codes';
import * as tar from 'tar-stream';

import AppConfig from '../../Config/AppConfig.js';
import logger from '../../Config/logger.js';
import AppError from '../../Utils/errors/AppError.js';

/**
 * Repo acquisition — GitHub tarball in, source files in memory out.
 *
 * No `git` subprocess, and nothing is ever written to disk: the tarball is
 * gunzipped and parsed as it streams, and only the files that survive the filter
 * are kept. A 25MB repo costs a few MB of heap and no cleanup.
 */

/** Files larger than this are not hand-written source. */
const MAX_FILE_BYTES = 512 * 1024;

/** A guard against a hostile or broken archive, not a real repo limit. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export interface FetchedRepo {
  /** Repo-relative path -> file contents. */
  files: Map<string, string>;
  /** The commit the tarball was cut from. */
  commit: string;
  /** Files that matched the filter but were skipped, and why. */
  skipped: Array<{ file: string; reason: string }>;
}

export interface FetchOptions {
  owner: string;
  name: string;
  /** Branch or tag. Defaults to the repo's default branch. */
  branch?: string;
  /** Keep only files under this repo-relative directory. */
  scope?: string;
  /** Decides which paths are worth keeping. */
  accept: (path: string) => boolean;
}

/**
 * GitHub's tarball root is `<owner>-<repo>-<sha>/`, which is where the commit
 * comes from — no extra API call, and it is guaranteed to describe the bytes we
 * actually analysed rather than whatever HEAD moved to since.
 */
const parseRoot = (entryPath: string): { root: string; commit: string } | null => {
  const root = entryPath.split('/')[0];
  const match = /-([0-9a-f]{7,40})$/.exec(root);
  return match ? { root, commit: match[1] } : null;
};

const tarballUrls = (owner: string, name: string, branch?: string): string[] => {
  const ref = branch ?? 'HEAD';
  return [
    // The documented API endpoint. It 302s to codeload; a PAT raises the limit.
    `https://api.github.com/repos/${owner}/${name}/tarball/${branch ?? ''}`,
    // Same archive, no API rate limit. Used when the API declines us — a rate
    // limit on a metadata endpoint should not stop us reading a public repo.
    branch
      ? `https://codeload.github.com/${owner}/${name}/tar.gz/refs/heads/${branch}`
      : `https://codeload.github.com/${owner}/${name}/tar.gz/${ref}`,
  ];
};

const fetchTarball = async (owner: string, name: string, branch?: string): Promise<Response> => {
  const headers: Record<string, string> = {
    'user-agent': 'ditto-indexer',
    accept: 'application/vnd.github+json',
  };
  if (AppConfig.GITHUB_TOKEN) headers.authorization = `Bearer ${AppConfig.GITHUB_TOKEN}`;

  const failures: string[] = [];
  for (const url of tarballUrls(owner, name, branch)) {
    const response = await fetch(url, { headers, redirect: 'follow' });
    if (response.ok && response.body) return response;

    failures.push(`${new URL(url).host} -> ${response.status}`);
    if (response.status === StatusCodes.NOT_FOUND) {
      throw new AppError(
        `${owner}/${name}${branch ? `@${branch}` : ''} not found. Private repos need GITHUB_TOKEN; check the branch name.`,
        StatusCodes.NOT_FOUND
      );
    }
    logger.warn(`tarball fetch from ${new URL(url).host} returned ${response.status} — trying next source`);
  }

  throw new AppError(
    `Could not fetch ${owner}/${name}: ${failures.join(', ')}. ` +
      `Set GITHUB_TOKEN to raise the rate limit.`,
    StatusCodes.BAD_GATEWAY
  );
};

/**
 * Download and unpack a repo into memory.
 *
 * `accept` is applied per entry as it streams, so a 25MB archive of a repo we
 * only want one folder of never materialises in full.
 */
export const fetchRepoFiles = async ({
  owner,
  name,
  branch,
  scope,
  accept,
}: FetchOptions): Promise<FetchedRepo> => {
  const response = await fetchTarball(owner, name, branch);

  const files = new Map<string, string>();
  const skipped: Array<{ file: string; reason: string }> = [];
  let commit = 'unknown';
  let totalBytes = 0;

  const scopePrefix = scope ? `${scope.replace(/^\/+|\/+$/g, '')}/` : '';

  const extract = tar.extract();

  const pump = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const parsed = parseRoot(header.name);
      if (parsed) commit = parsed.commit;

      // Strip the `<owner>-<repo>-<sha>/` root to get repo-relative paths.
      const relative = header.name.slice(header.name.indexOf('/') + 1);

      const wanted =
        header.type === 'file' &&
        relative.length > 0 &&
        (!scopePrefix || relative.startsWith(scopePrefix)) &&
        accept(relative);

      if (!wanted) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      if (typeof header.size === 'number' && header.size > MAX_FILE_BYTES) {
        skipped.push({ file: relative, reason: `${header.size} bytes exceeds the ${MAX_FILE_BYTES}-byte limit` });
        stream.resume();
        stream.on('end', next);
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_BYTES) reject(new Error('tarball exceeded the size guard'));
      });
      stream.on('end', () => {
        files.set(relative, Buffer.concat(chunks).toString('utf8'));
        next();
      });
      stream.on('error', reject);
    });

    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  // Node's fetch gives a web stream; the tar parser wants a node one.
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('error', (err) => extract.destroy(err));
  body.pipe(createGunzip()).pipe(extract);

  await pump;

  if (files.size === 0) {
    throw new AppError(
      scope
        ? `No source files found under "${scope}" in ${owner}/${name}. Check the --scope path.`
        : `No source files found in ${owner}/${name}.`,
      StatusCodes.UNPROCESSABLE_ENTITY
    );
  }

  return { files, commit, skipped };
};
