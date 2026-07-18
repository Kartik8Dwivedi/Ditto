/**
 * Deployment configuration for the hosted demo.
 *
 * ⚠️ Build-time vs runtime, which matters for toggling on Vercel:
 * `NEXT_PUBLIC_*` variables are INLINED into the bundle by `next build`, so
 * changing one in the Vercel dashboard does nothing until you redeploy (see
 * node_modules/next/dist/docs/01-app/02-guides/environment-variables.md).
 *
 * Every surface that reads these is server-rendered, so each flag checks a
 * plain (non-public) variable FIRST — that one is read per request and can be
 * flipped without a rebuild — and falls back to the `NEXT_PUBLIC_` name.
 * These are exported as functions, not consts, so the runtime value is read at
 * call time rather than frozen when the module is first evaluated.
 *
 *   RESTRICTED_MODE=true              → runtime toggle, no redeploy needed
 *   NEXT_PUBLIC_RESTRICTED_MODE=true  → build-time toggle, needs a redeploy
 */

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Restricted mode: live analysis is capped to conserve OpenAI credits. It is a
 * budget guardrail on the hosted demo, not a limit of the pipeline.
 */
export function isRestrictedMode(): boolean {
  return (
    parseBool(process.env.RESTRICTED_MODE) ||
    parseBool(process.env.NEXT_PUBLIC_RESTRICTED_MODE)
  );
}

/** Largest repo (in functions) the hosted demo will analyse on demand. */
export function liveMaxFunctions(): number {
  const raw = process.env.LIVE_MAX_FUNCTIONS ?? process.env.NEXT_PUBLIC_LIVE_MAX_FUNCTIONS;
  const parsed = Number(raw);
  // Fallback matches the documented JUDGING-mode cap (docs/ONDEMAND.md), so a
  // missing env var can never make the UI quote a limit the backend doesn't use.
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 600;
}

/** Source, so anyone can run the pipeline unrestricted. */
export const GITHUB_REPO_URL = 'https://github.com/Kartik8Dwivedi/openai-codex-hackathon';

export type SuggestedRepo = {
  /** Full GitHub URL — pasted verbatim into the analyse box. */
  url: string;
  /** `owner/name`, shown on the chip. */
  slug: string;
  /** Function count, measured with `npm run index`. */
  functions: number;
};

export type SuggestedRepoGroup = {
  label: string;
  /** One line telling a judge what this group demonstrates. */
  hint: string;
  repos: SuggestedRepo[];
};

/**
 * Repos verified to sit under the live cap.
 *
 * Every count here was measured with `npm run index` — not estimated. Only add
 * a repo after measuring it: an unverified suggestion that turns out to be over
 * the cap walks a judge straight into the failure the banner exists to prevent.
 *
 * The two groups are deliberate. A clean library returning zero clusters is a
 * CORRECT result, not a failure, and grouping says so before a judge can read
 * an empty map as the tool being broken.
 */
export const SUGGESTED_REPO_GROUPS: SuggestedRepoGroup[] = [
  {
    label: 'Likely to find duplicates',
    hint: 'Real application code, where the same job tends to get written more than once.',
    repos: [
      {
        url: 'https://github.com/misa-j/social-network',
        slug: 'misa-j/social-network',
        functions: 453,
      },
      { url: 'https://github.com/dcramer/dex', slug: 'dcramer/dex', functions: 458 },
      {
        url: 'https://github.com/giladfuchs/next-ecommerce',
        slug: 'giladfuchs/next-ecommerce',
        functions: 449,
      },
    ],
  },
  {
    label: 'Correctly finds nothing (Ditto not crying wolf)',
    hint: 'Small, disciplined libraries. Zero clusters here is the right answer — worth seeing.',
    repos: [
      {
        url: 'https://github.com/sindresorhus/pretty-bytes',
        slug: 'sindresorhus/pretty-bytes',
        functions: 7,
      },
      { url: 'https://github.com/lukeed/clsx', slug: 'lukeed/clsx', functions: 6 },
    ],
  },
];
