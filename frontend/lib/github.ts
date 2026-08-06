/**
 * Parse and validate a GitHub repo reference, client-side.
 *
 * Accepts the forms a user is likely to paste — a full URL, a bare
 * `github.com/owner/name`, a `.git` clone URL, a deep link into the tree, or the
 * `owner/name` shorthand — and rejects anything that is not a GitHub repo. This
 * is a fast local check so the paste box can show an inline error before we ever
 * hit the backend; the backend still validates authoritatively.
 */

const NAME = /^[A-Za-z0-9._-]+$/;

export type GitHubRepoRef = { owner: string; name: string };

export function parseGitHubRepo(input: string): GitHubRepoRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  let rest: string;
  const onGithub = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (onGithub) {
    rest = onGithub[1];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /\.[a-z]{2,}\//i.test(trimmed)) {
    // Looks like a URL, but not github.com — a different host, so reject.
    return null;
  } else {
    // Bare `owner/name` shorthand.
    rest = trimmed;
  }

  rest = rest
    .replace(/[?#].*$/, '') // drop query/hash
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, name] = parts;
  if (!NAME.test(owner) || !NAME.test(name)) return null;
  return { owner, name };
}

export function isValidGitHubRepo(input: string): boolean {
  return parseGitHubRepo(input) !== null;
}

export type GitHubPullRequestRef = { owner: string; name: string; prNumber: number };

/**
 * Parse a pull-request URL — `github.com/owner/repo/pull/<n>` — keeping the PR
 * number that `parseGitHubRepo` deliberately drops. Only the full github.com
 * form is accepted here (there is no unambiguous `owner/name` shorthand for a
 * PR). A fast local check so the PR box can reject non-PR input before we ever
 * hit the backend; the backend still validates authoritatively.
 */
export function parsePullRequest(input: string): GitHubPullRequestRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const onGithub = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (!onGithub) return null;

  const rest = onGithub[1]
    .replace(/[?#].*$/, '') // drop query/hash
    .replace(/^\/+|\/+$/g, '');

  const parts = rest.split('/').filter(Boolean);
  // owner / name / pull / <number>
  if (parts.length < 4) return null;

  const [owner, name, kind, numRaw] = parts;
  if (kind.toLowerCase() !== 'pull') return null;
  if (!NAME.test(owner) || !NAME.test(name)) return null;

  const prNumber = Number(numRaw);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;

  return { owner, name, prNumber };
}

export function isValidPullRequest(input: string): boolean {
  return parsePullRequest(input) !== null;
}

/** A normalised `owner/name` for display and dedup, or null if invalid. */
export function repoSlug(input: string): string | null {
  const ref = parseGitHubRepo(input);
  return ref ? `${ref.owner}/${ref.name}` : null;
}
