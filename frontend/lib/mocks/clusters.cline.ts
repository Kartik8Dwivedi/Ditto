/**
 * Fixtures — `cline/cline`.
 *
 * The hero cluster (`truncate-text`) is REAL, and mirrors what Ditto's pipeline
 * actually produced: a clean TWO-member cluster — two plain-string truncators,
 * one silently buggy — NOT a bag of everything named truncateText. The pipeline
 * deliberately excluded two look-alikes (see the note in `differences`), which
 * is the stronger story: Ditto reasoned about which functions are genuinely
 * equivalent instead of matching on the name.
 *
 * Every `divergence` marked `executed: true` in this file was produced by
 * execution, never by hand. `lib/mocks/audit.mjs` recompiles the bodies out of
 * this file, re-runs the consistency checks, and fails if a recorded output or
 * a `diverged` flag does not match reality. If you edit a body, run the audit.
 */
import type { ClusterDetail } from '@/types/ditto';

/* ------------------------------------------------------------------ *
 * 1. truncate-text — THE HERO. Real 2-member cluster from cline/cline.
 *
 * Two functions, both plain-string truncators with the same (text, maxLength)
 * signature. compaction-shared keeps `maxLength` characters and appends a
 * notice. project.ts tries to reserve room for that notice, but the notice is
 * longer than the whole budget — so it clamps to a single character. Asked to
 * clip a 26-char string to 20, it returns just "a".
 * ------------------------------------------------------------------ */
const truncateText: ClusterDetail = {
  id: 'cl_truncate_text',
  domain: 'truncate-text',
  behaviorSummary: 'Clip a string to a maximum length and mark that it was clipped',
  memberCount: 2,
  confidence: 0.94,
  disagreementRisk: 'semantic',
  hasProvenDivergence: true,
  linesRemovable: 34,
  members: [
    {
      id: 'fn_truncate_compaction',
      name: 'truncateText',
      file: 'sdk/packages/core/src/extensions/context/compaction-shared.ts',
      startLine: 70,
      endLine: 76,
      loc: 7,
      isPure: true,
      // Canonical: it honours the contract — the kept text is bounded by
      // maxLength, and the notice is added on top by design.
      isCanonical: true,
      body: `export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const removed = text.length - maxLength;
  return text.slice(0, maxLength) + '\\n...[truncated ' + removed + ' chars]';
}`,
    },
    {
      id: 'fn_truncate_budget',
      name: 'truncateText',
      file: 'sdk/packages/core/src/extensions/context/budget-projection/project.ts',
      startLine: 329,
      endLine: 337,
      loc: 9,
      isPure: true,
      isCanonical: false,
      body: `export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  // Reserve room for the truncation notice itself.
  const reserve = '\\n...[truncated ' + text.length + ' chars]';
  const keep = Math.max(1, maxLength - reserve.length);
  return text.slice(0, keep) + '\\n...[truncated ' + (text.length - keep) + ' chars]';
}`,
    },
  ],
  differences: [
    'project.ts:329 is broken. It reserves room for its own "[truncated N chars]" notice, but that notice is longer than the whole budget it was given — so the Math.max(1, …) clamp collapses the kept text to a single character. Asked to clip a 26-character string to 20, it keeps exactly one letter.',
    'compaction-shared.ts:70 does the honest thing: it keeps maxLength characters of the original, then appends the notice on top. Same intent, same signature — but one of the two silently destroys the text it was asked to shorten.',
    'Ditto excluded two look-alikes that a name match would have swept in: team-tools.ts:81 also collapses internal whitespace before clipping (extra behaviour, not equivalent), and truncateToolResultContent operates on structured tool output rather than a plain string (a different job entirely). Same name, different meaning — leaving them out is the point.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        // The column headers already name the function; the input column shows
        // the arguments only, so the money row fits on screen at 1440px.
        input: '("hello", 20)',
        diverged: false,
        results: [
          { functionId: 'fn_truncate_compaction', output: '"hello"' },
          { functionId: 'fn_truncate_budget', output: '"hello"' },
        ],
      },
      {
        input: '("exactly twenty char", 20)',
        diverged: false,
        results: [
          { functionId: 'fn_truncate_compaction', output: '"exactly twenty char"' },
          { functionId: 'fn_truncate_budget', output: '"exactly twenty char"' },
        ],
      },
      {
        input: '("abcdefghijklmnopqrstuvwxyz", 20)',
        diverged: true,
        results: [
          {
            functionId: 'fn_truncate_compaction',
            output: '"abcdefghijklmnopqrst\\n...[truncated 6 chars]"',
          },
          { functionId: 'fn_truncate_budget', output: '"a\\n...[truncated 25 chars]"' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 2. deep-clone — three-way divergence, including a real throw.
 * ------------------------------------------------------------------ */
const deepClone: ClusterDetail = {
  id: 'cl_deep_clone',
  domain: 'deep-clone',
  behaviorSummary: 'Recursively copy a plain object without sharing references',
  memberCount: 3,
  confidence: 0.83,
  disagreementRisk: 'semantic',
  hasProvenDivergence: true,
  linesRemovable: 88,
  members: [
    {
      id: 'fn_deep_clone',
      name: 'deepClone',
      file: 'sdk/packages/core/src/utils/object.ts',
      startLine: 19,
      endLine: 21,
      loc: 3,
      isPure: true,
      isCanonical: true,
      body: `export function deepClone<T>(value: T): T {
  return structuredClone(value);
}`,
    },
    {
      id: 'fn_clone_deep',
      name: 'cloneDeep',
      file: 'sdk/packages/core/src/extensions/context/state.ts',
      startLine: 55,
      endLine: 57,
      loc: 3,
      isPure: true,
      isCanonical: false,
      body: `export function cloneDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}`,
    },
    {
      id: 'fn_copy_object',
      name: 'copyObject',
      file: 'sdk/packages/core/src/runtime/host/settings.ts',
      startLine: 102,
      endLine: 110,
      loc: 9,
      isPure: true,
      isCanonical: false,
      body: `export function copyObject<T>(src: T): T {
  if (src === null || typeof src !== 'object') return src;
  if (Array.isArray(src)) return src.map(copyObject) as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    out[key] = copyObject((src as Record<string, unknown>)[key]);
  }
  return out as T;
}`,
    },
  ],
  differences: [
    'cloneDeep round-trips through JSON: it silently drops undefined values, turns NaN into null, and converts Date objects into ISO strings.',
    'copyObject walks Object.keys, so a Date clones to an empty object {} — it loses the timestamp entirely.',
    'deepClone throws DataCloneError on a function-valued property, where the other two quietly succeed with different results. A throw is still a disagreement.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '{ id: 1, tags: ["a"] }',
        diverged: false,
        results: [
          { functionId: 'fn_deep_clone', output: '{ id: 1, tags: ["a"] }' },
          { functionId: 'fn_clone_deep', output: '{ id: 1, tags: ["a"] }' },
          { functionId: 'fn_copy_object', output: '{ id: 1, tags: ["a"] }' },
        ],
      },
      {
        input: '{ createdAt: new Date(0) }',
        diverged: true,
        results: [
          { functionId: 'fn_deep_clone', output: '{ createdAt: Date(1970-01-01T00:00:00.000Z) }' },
          { functionId: 'fn_clone_deep', output: '{ createdAt: "1970-01-01T00:00:00.000Z" }' },
          { functionId: 'fn_copy_object', output: '{ createdAt: {} }' },
        ],
      },
      {
        input: '{ a: undefined, b: 1 }',
        diverged: true,
        results: [
          { functionId: 'fn_deep_clone', output: '{ a: undefined, b: 1 }' },
          { functionId: 'fn_clone_deep', output: '{ b: 1 }' },
          { functionId: 'fn_copy_object', output: '{ a: undefined, b: 1 }' },
        ],
      },
      {
        input: '{ n: NaN }',
        diverged: true,
        results: [
          { functionId: 'fn_deep_clone', output: '{ n: NaN }' },
          { functionId: 'fn_clone_deep', output: '{ n: null }' },
          { functionId: 'fn_copy_object', output: '{ n: NaN }' },
        ],
      },
      {
        input: '{ onSave: () => 1 }',
        diverged: true,
        results: [
          { functionId: 'fn_deep_clone', output: '', error: 'DataCloneError' },
          { functionId: 'fn_clone_deep', output: '{}' },
          { functionId: 'fn_copy_object', output: '{ onSave: [Function] }' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 3. deep-equal — the classic key-order bug.
 * ------------------------------------------------------------------ */
const deepEqual: ClusterDetail = {
  id: 'cl_deep_equal',
  domain: 'deep-equal',
  behaviorSummary: 'Decide whether two values are structurally equal',
  memberCount: 2,
  confidence: 0.87,
  disagreementRisk: 'semantic',
  hasProvenDivergence: true,
  linesRemovable: 64,
  members: [
    {
      id: 'fn_deep_equal',
      name: 'deepEqual',
      file: 'sdk/packages/core/src/utils/object.ts',
      startLine: 48,
      endLine: 58,
      loc: 11,
      isPure: true,
      isCanonical: true,
      body: `export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}`,
    },
    {
      id: 'fn_is_equal',
      name: 'isEqual',
      file: 'sdk/packages/core/src/extensions/context/diff.ts',
      startLine: 26,
      endLine: 28,
      loc: 3,
      isPure: true,
      isCanonical: false,
      body: `export function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}`,
    },
  ],
  differences: [
    'isEqual compares serialised text, so it depends on key insertion order: { a: 1, b: 2 } and { b: 2, a: 1 } are the same object but different strings.',
    'isEqual also reports two objects equal when both serialise to the same thing after JSON drops undefined — { a: undefined } and {} both become "{}".',
    'deepEqual compares structurally and is order-independent.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: 'deepEqual({ a: 1 }, { a: 1 })',
        diverged: false,
        results: [
          { functionId: 'fn_deep_equal', output: 'true' },
          { functionId: 'fn_is_equal', output: 'true' },
        ],
      },
      {
        input: 'deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })',
        diverged: true,
        results: [
          { functionId: 'fn_deep_equal', output: 'true' },
          { functionId: 'fn_is_equal', output: 'false' },
        ],
      },
      {
        input: 'deepEqual({ a: undefined }, {})',
        diverged: true,
        results: [
          { functionId: 'fn_deep_equal', output: 'false' },
          { functionId: 'fn_is_equal', output: 'true' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 4. date-format — they really differ, but only cosmetically.
 * ------------------------------------------------------------------ */
const dateFormat: ClusterDetail = {
  id: 'cl_date_format',
  domain: 'date-format',
  behaviorSummary: 'Render a Date as a day-first calendar string',
  memberCount: 3,
  confidence: 0.91,
  disagreementRisk: 'cosmetic',
  hasProvenDivergence: true,
  linesRemovable: 58,
  members: [
    {
      id: 'fn_format_date',
      name: 'formatDate',
      file: 'sdk/packages/core/src/utils/date.ts',
      startLine: 6,
      endLine: 12,
      loc: 7,
      isPure: true,
      isCanonical: true,
      body: `export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}`,
    },
    {
      id: 'fn_to_display_date',
      name: 'toDisplayDate',
      file: 'sdk/packages/core/src/extensions/tools/report.ts',
      startLine: 40,
      endLine: 44,
      loc: 5,
      isPure: true,
      isCanonical: false,
      body: `export function toDisplayDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return day + '-' + month + '-' + d.getFullYear();
}`,
    },
    {
      id: 'fn_human_date',
      name: 'humanDate',
      file: 'webview-ui/src/utils/format.ts',
      startLine: 17,
      endLine: 19,
      loc: 3,
      isPure: true,
      isCanonical: false,
      body: `export function humanDate(d: Date): string {
  return d.toLocaleDateString('en-GB');
}`,
    },
  ],
  differences: [
    'toDisplayDate joins with hyphens; the other two use slashes. Same day, month and year in the same order — only the separator differs.',
    'This is a presentation inconsistency, not a correctness bug. Ditto does not call it a conflict.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: 'new Date(2026, 6, 17)',
        diverged: true,
        results: [
          { functionId: 'fn_format_date', output: '"17/07/2026"' },
          { functionId: 'fn_to_display_date', output: '"17-07-2026"' },
          { functionId: 'fn_human_date', output: '"17/07/2026"' },
        ],
      },
      {
        input: 'new Date(2026, 0, 5)',
        diverged: true,
        results: [
          { functionId: 'fn_format_date', output: '"05/01/2026"' },
          { functionId: 'fn_to_display_date', output: '"05-01-2026"' },
          { functionId: 'fn_human_date', output: '"05/01/2026"' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 5. format-bytes — cosmetic.
 * ------------------------------------------------------------------ */
const formatBytes: ClusterDetail = {
  id: 'cl_format_bytes',
  domain: 'format-bytes',
  behaviorSummary: 'Render a byte count as a human-readable size',
  memberCount: 2,
  confidence: 0.9,
  disagreementRisk: 'cosmetic',
  hasProvenDivergence: true,
  linesRemovable: 31,
  members: [
    {
      id: 'fn_format_bytes',
      name: 'formatBytes',
      file: 'sdk/packages/core/src/utils/format.ts',
      startLine: 14,
      endLine: 23,
      loc: 10,
      isPure: true,
      isCanonical: true,
      body: `export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n = n / 1024;
    i++;
  }
  return n.toFixed(1) + ' ' + units[i];
}`,
    },
    {
      id: 'fn_human_size',
      name: 'humanSize',
      file: 'webview-ui/src/utils/size.ts',
      startLine: 3,
      endLine: 8,
      loc: 6,
      isPure: true,
      isCanonical: false,
      body: `export function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = bytes < 1024 ? 0 : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return value.toFixed(1) + units[exp];
}`,
    },
  ],
  differences: [
    'formatBytes puts a space between the number and the unit; humanSize does not. The number itself is identical.',
    'Cosmetic only — but it means two different size formats ship in the same UI.',
  ],
  divergence: {
    executed: true,
    rows: [
      {
        input: '512',
        diverged: true,
        results: [
          { functionId: 'fn_format_bytes', output: '"512.0 B"' },
          { functionId: 'fn_human_size', output: '"512.0B"' },
        ],
      },
      {
        input: '1536',
        diverged: true,
        results: [
          { functionId: 'fn_format_bytes', output: '"1.5 KB"' },
          { functionId: 'fn_human_size', output: '"1.5KB"' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 6. path-containment — NOT executed. The LLM predicted these outputs.
 *    Two of the three touch the filesystem, so the probe stage skipped the
 *    cluster. The UI must say so, loudly.
 * ------------------------------------------------------------------ */
const pathContainment: ClusterDetail = {
  id: 'cl_path_containment',
  domain: 'path-containment',
  behaviorSummary: 'Decide whether a path lies inside the workspace root',
  memberCount: 3,
  confidence: 0.86,
  disagreementRisk: 'semantic',
  hasProvenDivergence: false,
  linesRemovable: 41,
  members: [
    {
      id: 'fn_is_path_inside',
      name: 'isPathInside',
      file: 'sdk/packages/core/src/utils/path.ts',
      startLine: 31,
      endLine: 34,
      loc: 4,
      isPure: true,
      isCanonical: true,
      body: `export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}`,
    },
    {
      id: 'fn_within_workspace',
      name: 'withinWorkspace',
      file: 'sdk/packages/core/src/runtime/host/fs-guard.ts',
      startLine: 58,
      endLine: 62,
      loc: 5,
      isPure: false,
      isCanonical: false,
      body: `export function withinWorkspace(target: string, root: string): boolean {
  const realTarget = fs.realpathSync(target);
  const realRoot = fs.realpathSync(root);
  return realTarget.startsWith(realRoot);
}`,
    },
    {
      id: 'fn_is_under_root',
      name: 'isUnderRoot',
      file: 'sdk/packages/core/src/extensions/tools/file/access.ts',
      startLine: 19,
      endLine: 21,
      loc: 3,
      isPure: true,
      isCanonical: false,
      body: `export function isUnderRoot(p: string, root: string): boolean {
  return p.startsWith(root);
}`,
    },
  ],
  differences: [
    'withinWorkspace resolves symlinks with fs.realpathSync — it reads the filesystem, so Ditto will not execute it and its answer depends on what is on disk.',
    'isUnderRoot is a bare string prefix test: it does not normalise "..", so a path like <root>/../secrets can pass a check that isPathInside rejects.',
    'These three are not interchangeable, and the model expects them to disagree — but nothing here has been proven. Verify before acting on it.',
  ],
  divergence: {
    executed: false,
    rows: [
      {
        input: '("/ws/src/a.ts", "/ws")',
        diverged: false,
        results: [
          { functionId: 'fn_is_path_inside', output: 'true' },
          { functionId: 'fn_within_workspace', output: 'true' },
          { functionId: 'fn_is_under_root', output: 'true' },
        ],
      },
      {
        input: '("/ws/../secrets.txt", "/ws")',
        diverged: true,
        results: [
          { functionId: 'fn_is_path_inside', output: 'false' },
          { functionId: 'fn_within_workspace', output: 'false' },
          { functionId: 'fn_is_under_root', output: 'true' },
        ],
      },
      {
        input: '("/workspace-2/a.ts", "/workspace")',
        diverged: true,
        results: [
          { functionId: 'fn_is_path_inside', output: 'false' },
          { functionId: 'fn_within_workspace', output: 'false' },
          { functionId: 'fn_is_under_root', output: 'true' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 7-12. Lower-signal clusters. They agree on every probed input, so they are
 * consolidation opportunities rather than bugs. They keep the map honest.
 * ------------------------------------------------------------------ */
const sanitizeFilename: ClusterDetail = {
  id: 'cl_sanitize_filename',
  domain: 'sanitize-filename',
  behaviorSummary: 'Strip unsafe characters out of a filename',
  memberCount: 2,
  confidence: 0.72,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 18,
  members: [
    {
      id: 'fn_sanitize_filename',
      name: 'sanitizeFilename',
      file: 'sdk/packages/core/src/utils/path.ts',
      startLine: 4,
      endLine: 10,
      loc: 7,
      isPure: true,
      isCanonical: true,
      body: `export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');
}`,
    },
    {
      id: 'fn_to_safe_name',
      name: 'toSafeName',
      file: 'sdk/packages/core/src/extensions/tools/file/write.ts',
      startLine: 15,
      endLine: 22,
      loc: 8,
      isPure: true,
      isCanonical: false,
      body: `export function toSafeName(input: string): string {
  const parts = input.toLowerCase().split(/[^a-z0-9.]+/);
  const kept: string[] = [];
  for (const p of parts) {
    if (p.length > 0) kept.push(p);
  }
  return kept.join('-');
}`,
    },
  ],
  differences: [
    'sanitizeFilename is regex-driven; toSafeName splits into parts and rejoins. Same output on every probed name.',
    'Low confidence: the adjudicator was not certain these share an intent rather than merely a shape.',
  ],
};

const debounceCluster: ClusterDetail = {
  id: 'cl_debounce',
  domain: 'debounce',
  behaviorSummary: 'Delay a callback until calls stop for a given interval',
  memberCount: 2,
  confidence: 0.95,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 22,
  members: [
    {
      id: 'fn_debounce',
      name: 'debounce',
      file: 'sdk/packages/core/src/utils/timing.ts',
      startLine: 11,
      endLine: 17,
      loc: 7,
      isPure: false,
      isCanonical: true,
      body: `export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}`,
    },
    {
      id: 'fn_delay_call',
      name: 'delayCall',
      file: 'webview-ui/src/utils/input.ts',
      startLine: 29,
      endLine: 38,
      loc: 10,
      isPure: false,
      isCanonical: false,
      body: `export function delayCall<A extends unknown[]>(cb: (...a: A) => void, wait: number) {
  let handle: ReturnType<typeof setTimeout> | null = null;
  function wrapped(...args: A) {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(function () {
      cb(...args);
    }, wait);
  }
  return wrapped;
}`,
    },
  ],
  differences: [
    'Identical semantics. delayCall uses a named function and an explicit null sentinel; debounce uses an arrow and undefined.',
    'Both are impure (they schedule timers), so Ditto did not execute them.',
  ],
};

const deepMerge: ClusterDetail = {
  id: 'cl_deep_merge',
  domain: 'deep-merge',
  behaviorSummary: 'Recursively merge a source object over a target object',
  memberCount: 2,
  confidence: 0.81,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 62,
  members: [
    {
      id: 'fn_deep_merge',
      name: 'deepMerge',
      file: 'sdk/packages/core/src/utils/object.ts',
      startLine: 63,
      endLine: 74,
      loc: 12,
      isPure: true,
      isCanonical: true,
      body: `export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const existing = out[k];
    const bothPlain = isPlainObject(existing) && isPlainObject(v);
    out[k] = bothPlain ? deepMerge(existing, v) : v;
  }
  return out;
}`,
    },
    {
      id: 'fn_merge_config',
      name: 'mergeConfig',
      file: 'sdk/packages/core/src/runtime/host/config.ts',
      startLine: 58,
      endLine: 75,
      loc: 18,
      isPure: true,
      isCanonical: false,
      body: `export function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return Object.keys(override).reduce(
    (acc, key) => {
      const left = acc[key];
      const right = override[key];
      if (isPlainObject(left) && isPlainObject(right)) {
        acc[key] = mergeConfig(left, right);
      } else {
        acc[key] = right;
      }
      return acc;
    },
    { ...base } as Record<string, unknown>,
  );
}`,
    },
  ],
  differences: [
    'deepMerge iterates entries with a for-of; mergeConfig folds with reduce. Same recursion, same result on every probed input.',
  ],
};

const safeJsonParse: ClusterDetail = {
  id: 'cl_safe_json_parse',
  domain: 'safe-json-parse',
  behaviorSummary: 'Parse JSON, returning a fallback instead of throwing',
  memberCount: 2,
  confidence: 0.77,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 51,
  members: [
    {
      id: 'fn_safe_json_parse',
      name: 'safeJsonParse',
      file: 'sdk/packages/core/src/utils/json.ts',
      startLine: 8,
      endLine: 14,
      loc: 7,
      isPure: true,
      isCanonical: true,
      body: `export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}`,
    },
    {
      id: 'fn_try_parse',
      name: 'tryParse',
      file: 'sdk/packages/core/src/api/transport.ts',
      startLine: 44,
      endLine: 52,
      loc: 9,
      isPure: true,
      isCanonical: false,
      body: `export function tryParse<T>(text: string, orElse: T): T {
  let result: T;
  try {
    result = JSON.parse(text) as T;
  } catch (err) {
    return orElse;
  }
  return result;
}`,
    },
  ],
  differences: [
    'Same behaviour on every probed input — both swallow the parse error and return the fallback.',
    'Low confidence: neither validates the parsed shape, so they could diverge on inputs the probe set did not reach. Treated as a near-duplicate, not a claim.',
  ],
};

const retryWithBackoff: ClusterDetail = {
  id: 'cl_retry_with_backoff',
  domain: 'retry-with-backoff',
  behaviorSummary: 'Retry a failing async call with exponential backoff',
  memberCount: 2,
  confidence: 0.9,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 72,
  members: [
    {
      id: 'fn_retry',
      name: 'retry',
      file: 'sdk/packages/core/src/utils/retry.ts',
      startLine: 7,
      endLine: 18,
      loc: 12,
      isPure: false,
      isCanonical: true,
      body: `export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await sleep(2 ** i * 100);
    }
  }
  throw lastError;
}`,
    },
    {
      id: 'fn_with_backoff',
      name: 'withBackoff',
      file: 'sdk/packages/core/src/api/client.ts',
      startLine: 82,
      endLine: 95,
      loc: 14,
      isPure: false,
      isCanonical: false,
      body: `export async function withBackoff<T>(task: () => Promise<T>, max = 3): Promise<T> {
  let delay = 100;
  let tries = 0;
  for (;;) {
    try {
      return await task();
    } catch (e) {
      tries += 1;
      if (tries >= max) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}`,
    },
  ],
  differences: [
    'Same backoff curve (100ms, 200ms, 400ms) and same attempt count, reached by a bounded for-loop versus an infinite loop with a counter.',
    'Both are impure (they sleep), so Ditto did not execute them.',
  ],
};

const stripAnsi: ClusterDetail = {
  id: 'cl_strip_ansi',
  domain: 'strip-ansi',
  behaviorSummary: 'Remove ANSI colour escape codes from terminal output',
  memberCount: 2,
  confidence: 0.93,
  disagreementRisk: 'none',
  hasProvenDivergence: false,
  linesRemovable: 15,
  members: [
    {
      id: 'fn_strip_ansi',
      name: 'stripAnsi',
      file: 'sdk/packages/core/src/runtime/host/terminal.ts',
      startLine: 12,
      endLine: 16,
      loc: 5,
      isPure: true,
      isCanonical: true,
      body: `const ANSI_PATTERN = /\\u001b\\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}`,
    },
    {
      id: 'fn_remove_colors',
      name: 'removeColors',
      file: 'sdk/packages/core/src/extensions/tools/shell/output.ts',
      startLine: 27,
      endLine: 29,
      loc: 3,
      isPure: true,
      isCanonical: false,
      body: `export function removeColors(s: string): string {
  return s.split(/\\u001b\\[[0-9;]*m/).join('');
}`,
    },
  ],
  differences: [
    'stripAnsi replaces matches; removeColors splits on the same pattern and rejoins. Identical output on every probed string.',
  ],
};

export const CLINE_CLUSTERS: ClusterDetail[] = [
  truncateText,
  deepClone,
  deepEqual,
  dateFormat,
  formatBytes,
  pathContainment,
  sanitizeFilename,
  debounceCluster,
  deepMerge,
  safeJsonParse,
  retryWithBackoff,
  stripAnsi,
];
