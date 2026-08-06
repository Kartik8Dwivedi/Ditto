/**
 * Fixture — one canned per-PR analysis (docs/RESUME_BUILD.md §3.4).
 *
 * Lets the whole PR flow (paste → results) be demoed before the backend lands.
 * It deliberately exercises all three finding states so every branch of the PR
 * results page renders:
 *
 *   1. proof: 'executed'  — a PR fn (`shortenText`) reinvents an existing
 *      `truncateText`; both pure, so Ditto really ran them and they disagree on
 *      every probed input. This is the money shot (red / proven).
 *   2. proof: 'suspected' — a PR fn reinvents an existing settings loader, but
 *      both touch disk, so nothing could be executed. Amber, never "proven".
 *   3. verdict: 'novel'   — a PR fn with no match. Green "no reinvention found".
 *
 * The executed outputs below were hand-traced from the two function bodies and
 * are internally consistent (this is a synthetic demo, not a real repo run).
 */
import type { PrAnalysis } from '@/types/ditto';

/*
 * The two pure functions behind finding #1, for reference — traced by hand:
 *
 *   // existing (canonical)
 *   function truncateText(text, maxLength) {
 *     if (text.length <= maxLength) return text;
 *     return text.slice(0, maxLength - 1) + '…';
 *   }
 *
 *   // introduced by the PR (reinvented, and subtly wrong)
 *   function shortenText(text, max) {
 *     const words = text.split(' ');
 *     let out = '';
 *     for (const word of words) {
 *       if ((out + word).length > max) break;
 *       out += word + ' ';
 *     }
 *     return out.trim() + '…';   // appends '…' even when nothing was cut
 *   }
 */
export const MOCK_PR_ANALYSIS: PrAnalysis = {
  id: 'pr_cline_4821',
  owner: 'cline',
  name: 'cline',
  prNumber: 4821,
  headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  baseSha: '4f1c9ab00112233445566778899aabbccddeeff0',
  prUrl: 'https://github.com/cline/cline/pull/4821',
  changedFunctions: 3,
  createdAt: '2026-08-06T10:15:00.000Z',
  findings: [
    /* 1 ── EXECUTED. Reinvents truncateText, proven to disagree. */
    {
      newFunction: {
        name: 'shortenText',
        file: 'src/utils/string.ts',
        startLine: 42,
        endLine: 51,
      },
      match: {
        name: 'truncateText',
        file: 'src/shared/formatting.ts',
        startLine: 118,
        endLine: 121,
      },
      verdict: 'duplicate',
      similarity: 0.92,
      confidence: 0.9,
      usedBy: [
        'src/core/task/index.ts',
        'src/integrations/terminal/TerminalManager.ts',
        'webview-ui/src/components/chat/ChatRow.tsx',
      ],
      proof: 'executed',
      divergence: {
        executed: true,
        rows: [
          {
            input: '"Hello world foo", 8',
            diverged: true,
            results: [
              { functionId: 'baseline', output: '"Hello w…"' },
              { functionId: 'pr', output: '"Hello…"' },
            ],
          },
          {
            input: '"Short", 8',
            diverged: true,
            results: [
              { functionId: 'baseline', output: '"Short"' },
              { functionId: 'pr', output: '"Short…"' },
            ],
          },
          {
            input: '"a b c d e f", 5',
            diverged: true,
            results: [
              { functionId: 'baseline', output: '"a b …"' },
              { functionId: 'pr', output: '"a b c…"' },
            ],
          },
          {
            input: '"", 4',
            diverged: true,
            results: [
              { functionId: 'baseline', output: '""' },
              { functionId: 'pr', output: '"…"' },
            ],
          },
        ],
      },
    },

    /* 2 ── SUSPECTED. Impure both sides, so nothing was executed. */
    {
      newFunction: {
        name: 'fetchWorkspaceConfig',
        file: 'src/config/workspace.ts',
        startLine: 12,
        endLine: 34,
      },
      match: {
        name: 'loadSettings',
        file: 'src/core/storage/settings.ts',
        startLine: 55,
        endLine: 88,
      },
      verdict: 'duplicate',
      similarity: 0.87,
      confidence: 0.83,
      usedBy: ['src/core/controller/index.ts', 'src/services/mcp/McpHub.ts'],
      proof: 'suspected',
      divergence: null,
    },

    /* 3 ── NOVEL. No existing implementation matched. */
    {
      newFunction: {
        name: 'computeDiffStat',
        file: 'src/integrations/diff/stats.ts',
        startLine: 8,
        endLine: 29,
      },
      match: null,
      verdict: 'novel',
      similarity: 0.31,
      confidence: 0,
      usedBy: [],
      proof: 'none',
      divergence: null,
    },
  ],
};

/**
 * Mock lookup. In fixtures mode there is a single canned analysis, so a paste of
 * any PR URL resolves to it (see `analyzePR` in the API client). An id that does
 * not match returns undefined so the results page can 404 honestly.
 */
export function getMockPrAnalysis(id: string): PrAnalysis | undefined {
  return id === MOCK_PR_ANALYSIS.id ? MOCK_PR_ANALYSIS : undefined;
}
