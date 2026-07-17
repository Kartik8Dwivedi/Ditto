/**
 * Demo fixtures — `ditto-labs/ditto`.
 *
 * Ditto's own repo, analysed by Ditto. This is the "we used Ditto to fix Ditto"
 * moment: the tool found a real token-budget bug in its own indexer.
 *
 * These are mock API responses, not live analysis. Every `divergence` marked
 * `executed: true` below contains output that was produced by REALLY RUNNING
 * these exact function bodies in node. If you edit a body, re-run the probe and
 * update the rows. Never hand-write an output.
 *
 * The stats that a judge can verify by counting the cluster list are derived
 * from it (see `derive.ts`), not typed in, so they cannot drift.
 */
import type { ClusterDetail, RepoStats, RepoSummary } from '@/types/ditto';
import { deriveStats } from './derive';

/* ------------------------------------------------------------------ *
 * 1. token-estimate — the hero. Two token budgets that disagree by 67%
 *    decide whether we truncate a prompt. This one shipped.
 * ------------------------------------------------------------------ */
const tokenEstimate: ClusterDetail = {
  id: 'cl_token_estimate',
  domain: 'token-estimate',
  behaviorSummary: 'Estimate how many LLM tokens a string will cost',
  memberCount: 2,
  confidence: 0.88,
  disagreementRisk: 'semantic',
  hasProvenDivergence: true,
  linesRemovable: 14,
  members: [
    {
      id: 'fn_estimate_tokens',
      name: 'estimateTokens',
      file: 'src/indexer/tokens.ts',
      startLine: 14,
      endLine: 25,
      loc: 12,
      isPure: true,
      isCanonical: true,
      body: `export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let significant = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== ' ') {
      significant += 1;
    }
  }
  return Math.ceil(significant / 4);
}`,
    },
    {
      id: 'fn_approx_token_count',
      name: 'approxTokenCount',
      file: 'src/llm/budget.ts',
      startLine: 31,
      endLine: 37,
      loc: 7,
      isPure: true,
      isCanonical: false,
      body: `export function approxTokenCount(prompt: string): number {
  const words = prompt.split(' ').filter((word) => word.length > 0);
  const weighted = words.reduce((total, word) => {
    return total + (word.length > 8 ? 2 : 1);
  }, 0);
  return Math.round(weighted * 1.3);
}`,
    },
  ],
  differences: [
    'estimateTokens counts non-space characters and divides by 4. approxTokenCount counts space-separated words, charges long words double, then scales by 1.3. The two heuristics have no reason to agree and do not.',
    'On "const x = 1;" they return 3 and 5. src/indexer/tokens.ts packs the context window and src/llm/budget.ts checks it, so the packer believes it has room the checker does not — this is how a request gets truncated mid-prompt.',
    'Handed a non-string, estimateTokens silently returns 0 — the length of 42 is undefined, so the loop never runs — while approxTokenCount throws TypeError. One hides bad input, the other fails on it.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '"const x = 1;"',
        diverged: true,
        results: [
          { functionId: 'fn_estimate_tokens', output: '3' },
          { functionId: 'fn_approx_token_count', output: '5' },
        ],
      },
      {
        input: '""',
        diverged: false,
        results: [
          { functionId: 'fn_estimate_tokens', output: '0' },
          { functionId: 'fn_approx_token_count', output: '0' },
        ],
      },
      {
        input: '"The quick brown fox jumps over the lazy dog"',
        diverged: true,
        results: [
          { functionId: 'fn_estimate_tokens', output: '9' },
          { functionId: 'fn_approx_token_count', output: '12' },
        ],
      },
      {
        input: '42',
        diverged: true,
        results: [
          { functionId: 'fn_estimate_tokens', output: '0' },
          { functionId: 'fn_approx_token_count', output: '', error: 'TypeError' },
        ],
      },
      {
        input: 'null',
        diverged: false,
        results: [
          { functionId: 'fn_estimate_tokens', output: '', error: 'TypeError' },
          { functionId: 'fn_approx_token_count', output: '', error: 'TypeError' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 2. cosine-similarity — the control. Written twice, agrees bit-for-bit.
 *    Proving sameness is as load-bearing as proving difference.
 * ------------------------------------------------------------------ */
const cosineSimilarity: ClusterDetail = {
  id: 'cl_cosine_similarity',
  domain: 'cosine-similarity',
  behaviorSummary: 'Cosine similarity between two embedding vectors',
  memberCount: 2,
  confidence: 0.96,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 21,
  members: [
    {
      id: 'fn_cosine_similarity',
      name: 'cosineSimilarity',
      file: 'src/embed/similarity.ts',
      startLine: 8,
      endLine: 22,
      loc: 15,
      isPure: true,
      isCanonical: true,
      body: `export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) {
    return 0;
  }
  return dot / denom;
}`,
    },
    {
      id: 'fn_vector_cosine',
      name: 'vectorCosine',
      file: 'src/search/rank.ts',
      startLine: 46,
      endLine: 54,
      loc: 9,
      isPure: true,
      isCanonical: false,
      body: `export function vectorCosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, i) => sum + value * right[i], 0);
  const normLeft = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const normRight = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (normLeft * normRight === 0) {
    return 0;
  }
  return dot / (normLeft * normRight);
}`,
    },
  ],
  differences: [
    'cosineSimilarity accumulates the dot product and both magnitudes in one indexed loop; vectorCosine derives each of the three with a separate reduce.',
    'Both sum in the same order and guard the zero vector the same way, so they agree bit-for-bit — including 0.2784438632618497, where a different summation order would have shown up in the last digits.',
    'A length mismatch yields NaN from both, so even the unhappy path matches. This is a consolidation opportunity, not a bug.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '[1, 0, 0], [1, 0, 0]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: '1' },
          { functionId: 'fn_vector_cosine', output: '1' },
        ],
      },
      {
        input: '[1, 2, 3], [4, 5, 6]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: '0.9746318461970762' },
          { functionId: 'fn_vector_cosine', output: '0.9746318461970762' },
        ],
      },
      {
        input: '[0.12, 0.87, 0.44], [0.91, 0.02, 0.31]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: '0.2784438632618497' },
          { functionId: 'fn_vector_cosine', output: '0.2784438632618497' },
        ],
      },
      {
        input: '[1, -2, 3], [-1, 2, -3]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: '-1' },
          { functionId: 'fn_vector_cosine', output: '-1' },
        ],
      },
      {
        input: '[0, 0, 0], [1, 2, 3]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: '0' },
          { functionId: 'fn_vector_cosine', output: '0' },
        ],
      },
      {
        input: '[1, 2, 3], [1, 2]',
        diverged: false,
        results: [
          { functionId: 'fn_cosine_similarity', output: 'NaN' },
          { functionId: 'fn_vector_cosine', output: 'NaN' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 3. retry-llm-call — both members sleep and hit the network, so Ditto
 *    refused to execute them. The rows are predicted, and say so.
 * ------------------------------------------------------------------ */
const retryLlmCall: ClusterDetail = {
  id: 'cl_retry_llm_call',
  domain: 'retry-llm-call',
  behaviorSummary: 'Retry a failing LLM request with exponential backoff',
  memberCount: 2,
  confidence: 0.84,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 33,
  members: [
    {
      id: 'fn_with_retry',
      name: 'withRetry',
      file: 'src/llm/retry.ts',
      startLine: 12,
      endLine: 25,
      loc: 14,
      isPure: false,
      isCanonical: true,
      body: `export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  let delay = 250;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw lastError;
}`,
    },
    {
      id: 'fn_call_with_backoff',
      name: 'callWithBackoff',
      file: 'src/llm/client.ts',
      startLine: 88,
      endLine: 102,
      loc: 15,
      isPure: false,
      isCanonical: false,
      body: `export async function callWithBackoff<T>(
  task: () => Promise<T>,
  retriesLeft = 2,
  waitMs = 250,
): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (retriesLeft <= 0) {
      throw err;
    }
    await sleep(waitMs);
    return callWithBackoff(task, retriesLeft - 1, waitMs * 2);
  }
}`,
    },
  ],
  differences: [
    'Same attempt budget (3 calls) and the same 250ms then 500ms backoff curve, reached by a bounded loop versus recursion.',
    'withRetry sleeps a final 1000ms after the last failure before rethrowing; callWithBackoff rethrows immediately. Same value, one second apart.',
    'Both are impure — they sleep and call the network — so Ditto did not execute them. The rows below are predicted, not observed, and must not be read as proof.',
  ],
  divergence: {
    executed: false,
    rows: [
      {
        input: '() => Promise.resolve("ok")',
        diverged: false,
        results: [
          { functionId: 'fn_with_retry', output: '"ok"' },
          { functionId: 'fn_call_with_backoff', output: '"ok"' },
        ],
      },
      {
        input: '() => reject(429) twice, then resolve("ok")',
        diverged: false,
        results: [
          { functionId: 'fn_with_retry', output: '"ok"' },
          { functionId: 'fn_call_with_backoff', output: '"ok"' },
        ],
      },
      {
        input: '() => Promise.reject(new RateLimitError())',
        diverged: false,
        results: [
          { functionId: 'fn_with_retry', output: '', error: 'RateLimitError' },
          { functionId: 'fn_call_with_backoff', output: '', error: 'RateLimitError' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 4. normalize-file-path — proven to differ, but only in presentation.
 *    Confidence 0.79 is below the claim threshold, so the map degrades
 *    this to a dashed near-duplicate rather than asserting it.
 * ------------------------------------------------------------------ */
const normalizeFilePath: ClusterDetail = {
  id: 'cl_normalize_file_path',
  domain: 'normalize-file-path',
  behaviorSummary: 'Normalise a path to a repo-relative form',
  memberCount: 2,
  confidence: 0.79,
  disagreementRisk: 'cosmetic',
  hasProvenDivergence: true,
  linesRemovable: 12,
  members: [
    {
      id: 'fn_normalize_path',
      name: 'normalizePath',
      file: 'src/indexer/paths.ts',
      startLine: 9,
      endLine: 19,
      loc: 11,
      isPure: true,
      isCanonical: true,
      body: `export function normalizePath(raw: string): string {
  const parts = raw.split('/');
  const kept: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }
    kept.push(part.toLowerCase());
  }
  return kept.join('/');
}`,
    },
    {
      id: 'fn_to_repo_path',
      name: 'toRepoPath',
      file: 'src/git/walk.ts',
      startLine: 63,
      endLine: 69,
      loc: 7,
      isPure: true,
      isCanonical: false,
      body: `export function toRepoPath(input: string): string {
  return input
    .replace(/\\\\/g, '/')
    .replace(/^\\.\\//, '')
    .replace(/\\/+/g, '/')
    .replace(/^\\/|\\/$/g, '');
}`,
    },
  ],
  differences: [
    'normalizePath lower-cases every segment; toRepoPath preserves case. On "src/LLM/Client.ts" they return "src/llm/client.ts" and "src/LLM/Client.ts".',
    'toRepoPath rewrites backslashes to forward slashes; normalizePath splits on "/" alone, so a Windows path survives as one long segment.',
    'Both strip a leading "./" and collapse repeated slashes, and they agree on every POSIX-style path probed. The difference is separators and casing, not meaning — but on a case-sensitive checkout it would stop being cosmetic.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '"./src/indexer/tokens.ts"',
        diverged: false,
        results: [
          { functionId: 'fn_normalize_path', output: '"src/indexer/tokens.ts"' },
          { functionId: 'fn_to_repo_path', output: '"src/indexer/tokens.ts"' },
        ],
      },
      {
        input: '"src/LLM/Client.ts"',
        diverged: true,
        results: [
          { functionId: 'fn_normalize_path', output: '"src/llm/client.ts"' },
          { functionId: 'fn_to_repo_path', output: '"src/LLM/Client.ts"' },
        ],
      },
      {
        input: '"src\\\\git\\\\walk.ts"',
        diverged: true,
        results: [
          { functionId: 'fn_normalize_path', output: '"src\\\\git\\\\walk.ts"' },
          { functionId: 'fn_to_repo_path', output: '"src/git/walk.ts"' },
        ],
      },
      {
        input: '"//src//embed//"',
        diverged: false,
        results: [
          { functionId: 'fn_normalize_path', output: '"src/embed"' },
          { functionId: 'fn_to_repo_path', output: '"src/embed"' },
        ],
      },
    ],
  },
};

export const DITTO_REPO: RepoSummary = {
  id: 'ditto-labs-ditto',
  owner: 'ditto-labs',
  name: 'ditto',
  commit: '9c4e2f1',
  indexedAt: '2026-07-17T06:41:03.000Z',
};

export const DITTO_CLUSTERS: ClusterDetail[] = [
  tokenEstimate,
  cosineSimilarity,
  retryLlmCall,
  normalizeFilePath,
];

export const DITTO_STATS: RepoStats = deriveStats(DITTO_CLUSTERS, {
  functions: 368,
  files: 88,
  modules: 16,
  nearDuplicates: 9,
  reusableUtilities: 31,
  suspectedReinvented: 5,
  callSitesUnifiable: 13,
  healthScore: 79,
});
