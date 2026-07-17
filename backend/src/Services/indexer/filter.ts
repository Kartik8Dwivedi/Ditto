/**
 * Path filters — the first and cheapest prune. Zero tokens, zero API calls.
 *
 * Every file dropped here is a file we never parse and functions we never pay
 * to fingerprint. Note what is NOT dropped: nothing is excluded for being
 * un-exported or private. Duplication concentrates in exactly the small,
 * private, copy-pasted helpers, so an export-based filter would look right and
 * miss the entire product.
 */

/** Source we can parse. `.d.ts` is types only — no bodies, nothing to compare. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Directories that contain generated, vendored, or third-party code. */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'generated',
  '__generated__',
  '__snapshots__',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.git',
  '.yarn',
  'bower_components',
];

/**
 * Test files. Dropped because test helpers are duplicated ON PURPOSE — flagging
 * four copies of a mock builder is noise, and it would drown the real findings.
 */
const TEST_PATTERNS = [
  /(^|\/)tests?\//,
  /(^|\/)__tests__\//,
  /(^|\/)e2e\//,
  /(^|\/)spec\//,
  /\.(test|spec)\.[jt]sx?$/,
  /\.stories\.[jt]sx?$/,
];

/** Bundled, minified, or machine-written output masquerading as source. */
const GENERATED_PATTERNS = [
  /\.min\.[jt]sx?$/,
  /\.bundle\.[jt]sx?$/,
  /\.map$/,
  /\.d\.ts$/,
  /-lock\.json$/,
  /(^|\/)(package-lock|yarn\.lock|pnpm-lock\.yaml)$/,
  /\.pb\.[jt]s$/,
  /\.gen\.[jt]s$/,
];

const hasSourceExtension = (path: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));

const inExcludedDirectory = (path: string): boolean => {
  const segments = path.split('/');
  // The last segment is the filename, not a directory.
  return segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.includes(segment));
};

/** True when this repo-relative path is source code worth parsing. */
export const isSourceFile = (path: string): boolean => {
  if (!hasSourceExtension(path)) return false;
  if (inExcludedDirectory(path)) return false;
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(path))) return false;
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return false;
  return true;
};

/**
 * Function-level cheap filters, applied after parsing and before any model sees
 * anything.
 *
 * Deliberately conservative: this runs before we know what anything does, so it
 * only drops functions that CANNOT carry a behavioural finding — there is no
 * behaviour to duplicate in `x => x.id`. Anything with real logic survives,
 * exported or not.
 */
export const MIN_FUNCTION_LOC = 3;

export interface TriviallySkippable {
  name: string;
  loc: number;
  body: string;
  isAccessor: boolean;
}

/** A body that just forwards to something else, e.g. `(a) => other(a)`. */
const isTrivialWrapper = (body: string): boolean => {
  const stripped = body.replace(/\s+/g, ' ').trim();
  // One statement, and that statement is a single call being returned.
  return /^(export\s+)?(async\s+)?(function\s*\w*\s*)?\([^)]*\)\s*(=>|\{)\s*(return\s+)?[\w.]+\([^;{}]*\)\s*;?\s*\}?$/.test(
    stripped
  );
};

export const skipReason = (fn: TriviallySkippable): string | null => {
  if (fn.isAccessor) return 'getter/setter';
  if (fn.loc < MIN_FUNCTION_LOC) return `under ${MIN_FUNCTION_LOC} lines`;
  if (isTrivialWrapper(fn.body)) return 'trivial wrapper';
  return null;
};
