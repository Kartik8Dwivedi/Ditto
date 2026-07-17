/**
 * Demo fixtures — `actualbudget/actual`.
 *
 * A real open-source personal finance app, analysed by Ditto. The hero cluster
 * is not invented: `currencyToAmount` and `looselyParseAmount` are lifted
 * verbatim from upstream `packages/loot-core/src/shared/util.ts`, they really
 * are exported from the same file, and they really do disagree about which way
 * is negative. The supporting clusters are illustrative.
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
 * 1. currency-parse — the hero, and it is real. Two exported parsers,
 *    one file, opposite signs. Accounting notation reads as a debit to
 *    one of them and a credit to the other.
 * ------------------------------------------------------------------ */
const currencyParse: ClusterDetail = {
  id: 'cl_currency_parse',
  domain: 'currency-parse',
  behaviorSummary: 'Parse a user-entered currency string into a number',
  memberCount: 2,
  confidence: 0.92,
  disagreementRisk: 'semantic',
  hasProvenDivergence: true,
  linesRemovable: 47,
  members: [
    {
      id: 'fn_currency_to_amount',
      name: 'currencyToAmount',
      file: 'packages/loot-core/src/shared/util.ts',
      startLine: 236,
      endLine: 239,
      loc: 4,
      isPure: true,
      isCanonical: true,
      body: `export function currencyToAmount(currencyString: string): number | null {
  const amount = parseFloat(currencyString.replace(/[^\\d.-]/g, ''));
  return Number.isNaN(amount) ? null : amount;
}`,
    },
    {
      id: 'fn_loosely_parse_amount',
      name: 'looselyParseAmount',
      file: 'packages/loot-core/src/shared/util.ts',
      startLine: 248,
      endLine: 257,
      loc: 10,
      isPure: true,
      isCanonical: false,
      body: `export function looselyParseAmount(amount: string): number | null {
  const trimmed = amount.trim();
  const isNegative = /^\\(.*\\)$/.test(trimmed);
  const inner = isNegative ? trimmed.slice(1, -1) : trimmed;
  const parsed = parseFloat(inner.replace(/[^\\d.]/g, ''));
  if (Number.isNaN(parsed)) {
    return null;
  }
  return isNegative ? -parsed : parsed;
}`,
    },
  ],
  differences: [
    'In accounting notation "(1,234.56)" is NEGATIVE — that is how a bank export writes a debit. looselyParseAmount honours the parentheses and returns -1234.56. currencyToAmount does not: its regex keeps only digits, "." and "-", so the parentheses are stripped along with the "$" and the comma, and it returns +1234.56. One function reads a credit where the other reads a debit — a sign flip on money.',
    'The mistake is symmetric, which is what makes it nasty. Handed a plain "-1234.56", looselyParseAmount deletes the minus sign itself — its regex is [^\\d.], which does not spare "-" — and returns +1234.56, while currencyToAmount returns -1234.56. Each function gets the sign wrong, just for a different notation. Neither is a superset of the other, so there is no safe "delete one and keep the other" answer here.',
    'They agree on everything boring: "1,234.56" and "$50.00" parse identically in both, and "abc" is null in both. That is how this survived review. Both are exported from the same file — packages/loot-core/src/shared/util.ts — so which sign a parsed amount ends up with depends only on which of the two an import happens to reach for.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '"(1,234.56)"',
        diverged: true,
        results: [
          { functionId: 'fn_currency_to_amount', output: '1234.56' },
          { functionId: 'fn_loosely_parse_amount', output: '-1234.56' },
        ],
      },
      {
        input: '"1,234.56"',
        diverged: false,
        results: [
          { functionId: 'fn_currency_to_amount', output: '1234.56' },
          { functionId: 'fn_loosely_parse_amount', output: '1234.56' },
        ],
      },
      {
        input: '"-1234.56"',
        diverged: true,
        results: [
          { functionId: 'fn_currency_to_amount', output: '-1234.56' },
          { functionId: 'fn_loosely_parse_amount', output: '1234.56' },
        ],
      },
      {
        input: '"$50.00"',
        diverged: false,
        results: [
          { functionId: 'fn_currency_to_amount', output: '50' },
          { functionId: 'fn_loosely_parse_amount', output: '50' },
        ],
      },
      {
        input: '"abc"',
        diverged: false,
        results: [
          { functionId: 'fn_currency_to_amount', output: 'null' },
          { functionId: 'fn_loosely_parse_amount', output: 'null' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 2. format-currency-display — proven to differ, but only in notation.
 *    Cosmetic on screen; the parenthesised form it emits is exactly the
 *    one currency-parse misreads on the way back in.
 * ------------------------------------------------------------------ */
const formatCurrencyDisplay: ClusterDetail = {
  id: 'cl_format_currency_display',
  domain: 'format-currency-display',
  behaviorSummary: 'Render an integer number of cents as a currency string',
  memberCount: 2,
  confidence: 0.9,
  disagreementRisk: 'cosmetic',
  hasProvenDivergence: true,
  linesRemovable: 38,
  members: [
    {
      id: 'fn_integer_to_currency',
      name: 'integerToCurrency',
      file: 'packages/loot-core/src/shared/util.ts',
      startLine: 211,
      endLine: 218,
      loc: 8,
      isPure: true,
      isCanonical: true,
      body: `export function integerToCurrency(value: number): string {
  const amount = value / 100;
  const negative = amount < 0;
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return (negative ? '-$' : '$') + grouped + '.' + cents;
}`,
    },
    {
      id: 'fn_format_currency',
      name: 'formatCurrency',
      file: 'packages/desktop-client/src/util/currency.ts',
      startLine: 17,
      endLine: 23,
      loc: 7,
      isPure: true,
      isCanonical: false,
      body: `export function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    currencySign: 'accounting',
  });
}`,
    },
  ],
  differences: [
    'integerToCurrency assembles the string by hand — toFixed(2), a grouping regex, and a leading "-$" when the amount is negative. formatCurrency hands the number to Intl with currencySign: "accounting", which prints negatives in parentheses instead. On every positive amount probed the two come back byte-identical, down to "$1,000,000.00".',
    '-123456 cents is "-$1,234.56" in loot-core and "($1,234.56)" in the client. Same number, two notations — this is presentation, not meaning, so the risk is cosmetic: a user sees a different glyph, not a different balance.',
    'It stops being cosmetic on a round trip. The accounting form is precisely the notation currencyToAmount misreads: currencyToAmount(formatCurrency(-123456)) is 1234.56, not -1234.56. Format a refund here, parse it back with the canonical parser, and the sign is gone — see the currency-parse cluster.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '123456',
        diverged: false,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"$1,234.56"' },
          { functionId: 'fn_format_currency', output: '"$1,234.56"' },
        ],
      },
      {
        input: '-123456',
        diverged: true,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"-$1,234.56"' },
          { functionId: 'fn_format_currency', output: '"($1,234.56)"' },
        ],
      },
      {
        input: '0',
        diverged: false,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"$0.00"' },
          { functionId: 'fn_format_currency', output: '"$0.00"' },
        ],
      },
      {
        input: '-5',
        diverged: true,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"-$0.05"' },
          { functionId: 'fn_format_currency', output: '"($0.05)"' },
        ],
      },
      {
        input: '100000000',
        diverged: false,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"$1,000,000.00"' },
          { functionId: 'fn_format_currency', output: '"$1,000,000.00"' },
        ],
      },
      {
        input: '-999',
        diverged: true,
        results: [
          { functionId: 'fn_integer_to_currency', output: '"-$9.99"' },
          { functionId: 'fn_format_currency', output: '"($9.99)"' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 3. date-to-iso — the control. Two spellings of the same day, identical
 *    on every date probed. Proving sameness is as load-bearing as
 *    proving difference.
 * ------------------------------------------------------------------ */
const dateToIso: ClusterDetail = {
  id: 'cl_date_to_iso',
  domain: 'date-to-iso',
  behaviorSummary: 'Format a Date as a YYYY-MM-DD day string',
  memberCount: 2,
  confidence: 0.94,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 26,
  members: [
    {
      id: 'fn_day_from_date',
      name: 'dayFromDate',
      file: 'packages/loot-core/src/shared/months.ts',
      startLine: 42,
      endLine: 47,
      loc: 6,
      isPure: true,
      isCanonical: true,
      body: `export function dayFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}`,
    },
    {
      id: 'fn_to_iso_date',
      name: 'toISODate',
      file: 'packages/loot-core/src/server/accounts/parse-file.ts',
      startLine: 96,
      endLine: 100,
      loc: 5,
      isPure: true,
      isCanonical: false,
      body: `export function toISODate(value: Date): string {
  const iso = value.toISOString();
  const [datePart] = iso.split('T');
  return datePart;
}`,
    },
  ],
  differences: [
    'dayFromDate builds the day field by field — getUTCFullYear, getUTCMonth + 1, getUTCDate, each padded to two digits. toISODate takes toISOString() and keeps everything before the "T". Different code, same three fields.',
    'Both read the timestamp in UTC, so they agree on every date probed: the leap day 2024-02-29, the last millisecond of 2026, and 23:30Z all come back identical. Neither drifts a day, because neither consults the local zone.',
    'This is a consolidation opportunity, not a bug — one lives with the shared month helpers, the other in the file-import path, and nothing observed separates them.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: 'new Date("2026-07-17T11:52:47.000Z")',
        diverged: false,
        results: [
          { functionId: 'fn_day_from_date', output: '"2026-07-17"' },
          { functionId: 'fn_to_iso_date', output: '"2026-07-17"' },
        ],
      },
      {
        input: 'new Date("2026-01-01T00:00:00.000Z")',
        diverged: false,
        results: [
          { functionId: 'fn_day_from_date', output: '"2026-01-01"' },
          { functionId: 'fn_to_iso_date', output: '"2026-01-01"' },
        ],
      },
      {
        input: 'new Date("2026-12-31T23:59:59.999Z")',
        diverged: false,
        results: [
          { functionId: 'fn_day_from_date', output: '"2026-12-31"' },
          { functionId: 'fn_to_iso_date', output: '"2026-12-31"' },
        ],
      },
      {
        input: 'new Date("2024-02-29T12:00:00.000Z")',
        diverged: false,
        results: [
          { functionId: 'fn_day_from_date', output: '"2024-02-29"' },
          { functionId: 'fn_to_iso_date', output: '"2024-02-29"' },
        ],
      },
      {
        input: 'new Date("2026-07-17T23:30:00.000Z")',
        diverged: false,
        results: [
          { functionId: 'fn_day_from_date', output: '"2026-07-17"' },
          { functionId: 'fn_to_iso_date', output: '"2026-07-17"' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 4. month-range — one member reads the clock, so Ditto never executed
 *    it. No probe, no divergence table, and confidence 0.76 keeps this a
 *    dashed near-duplicate rather than a claim.
 * ------------------------------------------------------------------ */
const monthRange: ClusterDetail = {
  id: 'cl_month_range',
  domain: 'month-range',
  behaviorSummary: 'List every month between two bounds, inclusive',
  memberCount: 2,
  confidence: 0.76,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 19,
  members: [
    {
      id: 'fn_range_inclusive',
      name: 'rangeInclusive',
      file: 'packages/loot-core/src/shared/months.ts',
      startLine: 178,
      endLine: 186,
      loc: 9,
      isPure: true,
      isCanonical: true,
      body: `export function rangeInclusive(start: string, end: string): string[] {
  const months: string[] = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}`,
    },
    {
      id: 'fn_months_between',
      name: 'monthsBetween',
      file: 'packages/desktop-client/src/components/reports/reportRanges.ts',
      startLine: 54,
      endLine: 60,
      loc: 7,
      isPure: false,
      isCanonical: false,
      body: `export function monthsBetween(start: string, end: string = currentMonth()): string[] {
  const out: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}`,
    },
  ],
  differences: [
    'rangeInclusive walks from start to end with a while loop and pushes each month; monthsBetween does the same walk with a for loop. Both compare "YYYY-MM" strings and both include the end bound.',
    'monthsBetween defaults its end bound to currentMonth(), which reads the system clock, so it is not pure and Ditto did not execute this cluster. There is no divergence table below because there is no observation to report — a run today would not be replayable next month anyway.',
    'Confidence 0.76 is below the 0.8 claim threshold, so this stays a dashed near-duplicate rather than a duplicate claim. The extra default parameter is a real difference in signature, and with nothing executed there is no evidence to settle whether it is also a difference in behaviour.',
  ],
};

export const ACTUAL_REPO: RepoSummary = {
  id: 'actualbudget-actual',
  owner: 'actualbudget',
  name: 'actual',
  commit: 'b7d3a91',
  indexedAt: '2026-07-17T11:52:47.000Z',
};

export const ACTUAL_CLUSTERS: ClusterDetail[] = [
  currencyParse,
  formatCurrencyDisplay,
  dateToIso,
  monthRange,
];

/**
 * ⚠️ PLACEHOLDER NUMBERS — pending real counts (same caveat as clusters.cline's
 * CLINE_STATS). actualbudget/actual is a real public repo, so these seven
 * figures are checkable and not yet checked. The cluster data below is real;
 * the "Fixtures" badge is what keeps this honest until the numbers are.
 *
 * Derived from the clusters instead of seeded:
 * semanticDuplicateClusters · behavioralConflicts · linesRemovable
 */
export const ACTUAL_STATS: RepoStats = deriveStats(ACTUAL_CLUSTERS, {
  functions: 903,
  files: 211,
  modules: 38,
  nearDuplicates: 21,
  reusableUtilities: 96,
  suspectedReinvented: 7,
  callSitesUnifiable: 29,
  healthScore: 74,
});
