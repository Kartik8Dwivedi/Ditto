import { Worker } from 'node:worker_threads';
import { ts } from 'ts-morph';

import logger from '../Config/logger.js';
import type { DivergenceTable } from '../Models/index.js';

/**
 * EXECUTION — deterministic, no LLM, zero tokens. The differentiator.
 *
 * Everything upstream of this file is an opinion: a model said these functions
 * do the same thing. This file runs them on the same inputs and records what
 * they actually returned. "Three of these return 9876543210 and the fourth
 * returns 919876543210" is not a model opinion — it is executed ground truth,
 * and it is the most damning evidence the product has.
 *
 * Which means the one thing that must never happen is a fabricated row. Hence:
 *
 *   - ONLY functions the extractor proved pure are ever executed.
 *   - A function we cannot materialise is EXCLUDED from the table, never
 *     recorded as "threw" — a tooling failure must not masquerade as a
 *     behavioural difference.
 *   - `executed: true` is set only after real code really ran.
 *
 * The sandbox is two layers:
 *   1. A worker thread, so a wedged run is terminable from outside.
 *   2. A fresh `vm` context inside it, which has JS intrinsics and NOTHING else
 *      — no `process`, no `require`, no `fetch`, no timers. Not a policy, an
 *      absence: there is no filesystem or network to reach from in there.
 *
 * The vm timeout only applies to code running INSIDE `runInContext`. Pulling the
 * function out and calling it from the worker silently opts out of it and a
 * runaway loop runs forever — so the call is made inside the context too, and
 * only strings ever cross the realm boundary. The worker timeout is the outer
 * bound for what the vm timeout cannot interrupt at all (catastrophic regex
 * backtracking runs in native code and ignores it).
 */

/** Per call. A pure utility that needs a second is not a pure utility. */
export const PROBE_TIMEOUT_MS = 1_000;

/** No repo gets to hold the pipeline hostage. */
const MAX_WORKER_MS = 30_000;

/** Longer outputs are truncated for display only — never for comparison. */
const MAX_DISPLAY_CHARS = 2_000;

export interface ProbeMember {
  id: string;
  body: string;
  /** Purity, from the extractor. The gate on execution. */
  isPure: boolean;
  /**
   * Same-file declarations the body needs to run — helpers it calls, constants
   * it reads. Without these a function that is legitimately pure still throws
   * ReferenceError in the sandbox. See Services/indexer/preamble.ts.
   */
  preamble?: string;
}

/** One function × one input, as reported by the worker. */
export interface ProbeCell {
  input: string;
  functionId: string;
  /** Serialised return value; '' when it threw. */
  output: string;
  /** 'Name: message'; '' when it did not throw. */
  error: string;
  /**
   * Canonical identity of this result. Built from the FULL serialisation even
   * when `output` was truncated, so two different long outputs never collapse
   * into a false agreement.
   */
  key: string;
}

interface WorkerResult {
  cells: ProbeCell[];
  /** Members that could not be turned into a callable function. */
  unusable: Array<{ functionId: string; reason: string }>;
}

/**
 * The sandbox, as source text.
 *
 * Inlined rather than kept in its own file so it resolves identically under
 * tsx, vitest and plain node-on-dist — a worker that only loads in dev is a
 * demo that dies on stage. Node evaluates this as CommonJS, so `require` is
 * available out here in the worker (but never inside the vm context).
 */
const PROBE_WORKER_SOURCE = String.raw`
const vm = require('node:vm');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');

const { members, inputs, timeoutMs, maxDisplayChars } = workerData;

// NOTE: every line of this file lives inside a template literal in
// probe.service.ts. Do not use a backtick anywhere in it — one stray backtick
// ends the template and the rest of the sandbox reparses as TypeScript.

/**
 * Canonical serialisation, so deep-equality collapses to string equality.
 *
 * Injected into the sandbox as source text and executed IN there, so every
 * value it touches is same-realm. Object keys are sorted because {a,b} and
 * {b,a} are deep-equal and must not read as a divergence.
 */
const serialise = function (value, seen) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'undefined') return 'undefined';
  if (type === 'boolean') return String(value);
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bigint') return String(value) + 'n';
  if (type === 'symbol') return String(value);
  if (type === 'function') return '[Function]';
  if (type === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    if (Object.is(value, -0)) return '-0';
    return String(value);
  }

  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Date]') {
    const time = Date.prototype.valueOf.call(value);
    return Number.isNaN(time) ? 'Invalid Date' : new Date(time).toISOString();
  }
  if (tag === '[object RegExp]') return String(value);
  if (tag === '[object Error]') return 'Error(' + JSON.stringify(String(value.message)) + ')';

  if (seen.indexOf(value) !== -1) return '[Circular]';
  seen.push(value);
  let out;
  try {
    if (Array.isArray(value)) {
      out = '[' + value.map(function (item) { return serialise(item, seen); }).join(',') + ']';
    } else if (tag === '[object Map]') {
      const entries = [];
      Map.prototype.forEach.call(value, function (v, k) {
        entries.push(serialise(k, seen) + '=>' + serialise(v, seen));
      });
      out = 'Map{' + entries.join(',') + '}';
    } else if (tag === '[object Set]') {
      const items = [];
      Set.prototype.forEach.call(value, function (v) { items.push(serialise(v, seen)); });
      out = 'Set{' + items.join(',') + '}';
    } else {
      const keys = Object.keys(value).sort();
      out = '{' + keys.map(function (key) {
        return JSON.stringify(key) + ':' + serialise(value[key], seen);
      }).join(',') + '}';
    }
  } finally {
    seen.pop();
  }
  return out;
};

/**
 * Expressions that might yield the callable, in the order worth trying.
 * The extractor hands us whatever ts-morph printed for the node, so we cover
 * the shapes that actually occur and give up honestly if none of them parse.
 */
const candidateExpressions = function (rawSource) {
  const source = rawSource.replace(/^\s*export\s+(default\s+)?/, '');
  const list = [
    // Arrow functions, function expressions, and function declarations
    // (parenthesising a declaration turns it into an expression).
    '(' + source + ')',
    // Object-method shorthand: "normalise(s) { ... }" only parses inside an object.
    '(function () { var holder = {' + source + '}; var keys = Object.keys(holder); ' +
      'return keys.length === 1 ? holder[keys[0]] : null; })()',
  ];
  // A whole variable statement: "const f = (s) => ..." — take the initialiser.
  const stripped = source
    .replace(/^\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s*(:[^=]+)?=\s*/, '')
    .replace(/;\s*$/, '');
  if (stripped !== source) list.push('(' + stripped + ')');
  return list;
};

/**
 * Give one member its own context with the function compiled into it and a
 * __call entry point.
 *
 * __call lives inside the sandbox on purpose: the vm timeout only governs code
 * running inside runInContext, so the CALL has to happen in there too. It hands
 * back a JSON string, which means nothing but strings ever crosses out.
 */
const prepare = function (member) {
  const context = vm.createContext(Object.create(null));
  let lastError = 'not a recognised function form';

  for (const expression of candidateExpressions(member.body)) {
    try {
      // One compile per candidate: a syntax error is a compile failure, and no
      // try/catch inside a script can rescue the script that failed to parse.
      const kind = vm.runInContext('typeof (' + expression + ')', context, { timeout: timeoutMs });
      if (kind !== 'function') continue;

      const setup = function (withPreamble) {
        return (
          (withPreamble && member.preamble ? member.preamble + '\n' : '') +
          'const serialise = ' + serialise.toString() + ';\n' +
          'const __fn = ' + expression + ';\n' +
          'globalThis.__call = function (inputJson) {\n' +
          '  try {\n' +
          '    var value = __fn.apply(undefined, JSON.parse(inputJson));\n' +
          '    return JSON.stringify({ ok: true, value: serialise(value, []) });\n' +
          '  } catch (err) {\n' +
          '    var name = (err && err.name) ? String(err.name) : "Error";\n' +
          '    var message = (err && err.message) ? String(err.message) : String(err);\n' +
          '    return JSON.stringify({ ok: false, name: name, message: message });\n' +
          '  }\n' +
          '};'
        );
      };

      try {
        vm.runInContext(setup(true), context, { timeout: timeoutMs });
      } catch (preambleError) {
        // The preamble did not evaluate. The function may not need it, so try
        // once without — a ReferenceError later is caught and excluded, which
        // is far better than dropping a member we could have run.
        vm.runInContext(setup(false), context, { timeout: timeoutMs });
      }
      return { id: member.id, context: context };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
  }
  return { id: member.id, error: lastError };
};

const cells = [];
const unusable = [];
const ready = [];

for (const member of members) {
  // One context per function: no shared mutable global state between members,
  // so execution order cannot change a result.
  const prepared = prepare(member);
  if (prepared.context) ready.push(prepared);
  else unusable.push({ functionId: prepared.id, reason: prepared.error });
}

for (const input of inputs) {
  let args = null;
  try {
    args = JSON.parse(input);
  } catch (err) {
    continue;
  }
  if (!Array.isArray(args)) continue;

  for (const entry of ready) {
    let output = '';
    let error = '';
    let key = '';
    try {
      const raw = vm.runInContext('__call(' + JSON.stringify(input) + ')', entry.context, {
        timeout: timeoutMs,
      });
      const result = JSON.parse(raw);
      if (result.ok) {
        const full = result.value;
        const long = full.length > maxDisplayChars;
        // Key off the FULL serialisation even when truncating for display, so
        // two different long outputs never collapse into a false agreement.
        key = 'return:' + (long ? crypto.createHash('sha256').update(full).digest('hex') : full);
        output = long ? full.slice(0, maxDisplayChars) + '...' : full;
      } else {
        error = result.name + ': ' + result.message;
        // Keyed on the error TYPE, not its wording: two implementations that
        // both reject bad input with a TypeError agree, even if the messages
        // differ. Throw-versus-return, and TypeError-versus-RangeError, still
        // diverge.
        key = 'throw:' + result.name;
      }
    } catch (err) {
      // Only the vm itself can throw out here — in practice, a timeout. An
      // implementation that never returns has genuinely behaved differently
      // from one that did, so it is recorded rather than swallowed.
      const timedOut = err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
      const name = timedOut ? 'Timeout' : err && err.name ? String(err.name) : 'Error';
      error = timedOut
        ? 'Timeout: exceeded ' + timeoutMs + 'ms'
        : name + ': ' + (err && err.message ? err.message : String(err));
      key = 'throw:' + name;
    }
    cells.push({ input: input, functionId: entry.id, output: output, error: error, key: key });
  }
}

parentPort.postMessage({ cells: cells, unusable: unusable });
`;

/**
 * Strip TypeScript types so the vm — which runs plain JS, not TS — can execute
 * a real repo function.
 *
 * The extractor's `body` is verbatim source, kept as-is for display, so it is
 * full of `: string` / `: Amount | null` annotations that are a syntax error in
 * the sandbox. `transpileModule` erases types and lowers modern syntax without
 * touching runtime behaviour. The `"use strict";` prologue it prepends is
 * removed here because the worker wraps the body in `( ... )` and a directive
 * cannot sit inside an expression; `export` is left for the worker to strip.
 *
 * Best-effort: if transpilation somehow throws, the original source is returned
 * and the worker will exclude it honestly rather than the pipeline dying.
 */
export const transpileForSandbox = (source: string): string => {
  if (!source) return source;
  try {
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
        removeComments: false,
      },
    }).outputText;
    return out.replace(/^\s*["']use strict["'];?\s*/, '').trimStart();
  } catch {
    return source;
  }
};

/**
 * Group raw cells into divergence rows.
 *
 * Pure and exported so the comparison rule — the thing that decides whether we
 * put "CONFLICT" on screen — is unit-testable without spawning a thread.
 */
export const buildRows = (cells: ProbeCell[]): DivergenceTable['rows'] => {
  const byInput = new Map<string, ProbeCell[]>();
  for (const cell of cells) {
    const bucket = byInput.get(cell.input);
    if (bucket) bucket.push(cell);
    else byInput.set(cell.input, [cell]);
  }

  return [...byInput].map(([input, group]) => ({
    input,
    results: group.map((cell) => ({
      functionId: cell.functionId,
      output: cell.output,
      ...(cell.error ? { error: cell.error } : {}),
    })),
    // Any two members disagreeing on this input is a divergence.
    diverged: new Set(group.map((cell) => cell.key)).size > 1,
  }));
};

class ProbeService {
  /**
   * Execute a cluster's pure members on the adjudicator's adversarial inputs.
   *
   * Returns `undefined` — no table at all — whenever we cannot honestly produce
   * one: too few pure members, no inputs, or the sandbox itself failed. The
   * caller may then show a predicted table clearly labelled `executed: false`.
   * What it must never do is show `executed: true` for something we did not run.
   */
  async probe(members: ProbeMember[], probeInputs: string[]): Promise<DivergenceTable | undefined> {
    // THE GATE. Impure functions have database calls, network, and dependencies:
    // executing them is both meaningless and a security hole.
    const pure = members.filter((member) => member.isPure);
    if (pure.length < 2) {
      logger.info(
        `probe skipped: ${pure.length} of ${members.length} members are pure, need at least 2`
      );
      return undefined;
    }
    if (probeInputs.length === 0) {
      logger.info('probe skipped: adjudicator supplied no probe inputs');
      return undefined;
    }

    let result: WorkerResult;
    try {
      result = await this.runWorker(pure, probeInputs);
    } catch (err) {
      logger.warn('probe sandbox failed — no divergence table:', err instanceof Error ? err.message : err);
      return undefined;
    }

    for (const entry of result.unusable) {
      logger.warn(`probe could not materialise ${entry.functionId}: ${entry.reason} — excluded`);
    }

    // Excluding unusable members can drop us below two, at which point there is
    // nothing to compare and therefore nothing to claim.
    const executedIds = new Set(result.cells.map((cell) => cell.functionId));
    if (executedIds.size < 2) {
      logger.info(`probe produced ${executedIds.size} usable members — no divergence table`);
      return undefined;
    }

    return { executed: true, rows: buildRows(result.cells) };
  }

  /** Spawn the sandbox and hold it to a hard wall-clock bound. */
  private runWorker(members: ProbeMember[], inputs: string[]): Promise<WorkerResult> {
    const budget = Math.min(MAX_WORKER_MS, PROBE_TIMEOUT_MS * members.length * inputs.length + 2_000);

    return new Promise<WorkerResult>((resolve, reject) => {
      const worker = new Worker(PROBE_WORKER_SOURCE, {
        eval: true,
        workerData: {
          // Types are stripped here, on the main thread, where the TS compiler
          // lives — the worker is plain JS with no toolchain.
          members: members.map((member) => ({
            id: member.id,
            body: transpileForSandbox(member.body),
            preamble: member.preamble ? transpileForSandbox(member.preamble) : '',
          })),
          inputs,
          timeoutMs: PROBE_TIMEOUT_MS,
          maxDisplayChars: MAX_DISPLAY_CHARS,
        },
        // A probe has nothing to say and nowhere to say it.
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });

      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };

      const timer = setTimeout(
        () => finish(() => reject(new Error(`probe exceeded ${budget}ms`))),
        budget
      );

      worker.on('message', (message: WorkerResult) => finish(() => resolve(message)));
      worker.on('error', (err: Error) => finish(() => reject(err)));
      worker.on('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error(`probe worker exited with code ${code}`)));
      });
    });
  }
}

export default ProbeService;
