import { z } from 'zod';

import { BadRequestError } from '../Utils/errors/AppError.js';

/** Reusable Mongo ObjectId validator. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** POST /analyze — the pasted repo URL. Parsed richly by {@link parseGitHubUrl}. */
export const analyzeSchema = {
  body: z.object({ repoUrl: z.string().trim().min(1, 'repoUrl is required') }),
};
export type AnalyzeBody = z.infer<typeof analyzeSchema.body>;

/** POST /internal/run — the Cloud Tasks payload (in addition to the secret header). */
export const internalRunSchema = {
  body: z.object({ jobId: objectId }),
};
export type InternalRunBody = z.infer<typeof internalRunSchema.body>;

/** GET /jobs/:jobId */
export const jobIdSchema = {
  params: z.object({ jobId: objectId }),
};
export type JobIdParams = z.infer<typeof jobIdSchema.params>;

export interface ParsedRepo {
  owner: string;
  name: string;
  /** Branch/tag/commit taken from a /tree/<ref> or /commit/<ref> URL, else null. */
  ref: string | null;
}

/** GitHub paths whose first segment is a site feature, not a repo owner. */
const RESERVED_OWNERS = new Set([
  'orgs',
  'settings',
  'marketplace',
  'sponsors',
  'features',
  'about',
  'topics',
  'collections',
  'trending',
  'notifications',
  'explore',
  'pulls',
  'issues',
  'login',
  'join',
]);

const SEGMENT = /^[\w.-]+$/;

/**
 * Turn a pasted GitHub URL into `{ owner, name, ref }`, or throw a
 * client-friendly BadRequestError. Public github.com only — we never accept a
 * host we cannot fetch anonymously, and we strip a trailing `.git` and any
 * `/tree/<branch>` suffix so a copied browser URL just works.
 *
 * A pure function on purpose: it is the one piece of /analyze worth unit-testing
 * exhaustively, and keeping it out of the HTTP layer lets the tests do that.
 */
export const parseGitHubUrl = (raw: string): ParsedRepo => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestError('Enter a valid URL, e.g. https://github.com/owner/repo');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestError('Only http(s) GitHub URLs are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new BadRequestError('Only public github.com repositories are supported.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new BadRequestError('That is not a repository URL — expected github.com/owner/repo.');
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, '');

  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    throw new BadRequestError('That is not a repository URL — expected github.com/owner/repo.');
  }
  if (!SEGMENT.test(owner) || !name || !SEGMENT.test(name)) {
    throw new BadRequestError('That repository URL has an invalid owner or name.');
  }

  let ref: string | null = null;
  if (segments.length >= 4 && (segments[2] === 'tree' || segments[2] === 'commit')) {
    ref = decodeURIComponent(segments[3]);
  }

  return { owner, name, ref };
};
