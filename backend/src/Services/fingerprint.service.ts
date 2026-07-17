import pLimit from 'p-limit';

import OpenAIService from './openai.service.js';
import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';
import { FingerprintSchema, type ExtractedFunction, type Fingerprint } from '../Models/index.js';

/**
 * LLM STAGE 1 — behavioural fingerprinting.
 *
 * One function per call. The model never sees the file, the repo, or its
 * neighbours: context per call is tiny and CONSTANT, so cost scales with the
 * NUMBER of functions, not with repo size. That is the whole trick, and it is
 * why a cheap model and a content-hash cache are enough.
 */

/** Roughly the point where the API starts rate-limiting us rather than us it. */
export const FINGERPRINT_CONCURRENCY = 12;

/**
 * The prompt is the product here.
 *
 * Everything a normal code reader relies on — the name, the parameter names, the
 * comments — is exactly the signal that makes `normalizePhone` and
 * `formatMobile` look unrelated. So we forbid all of it, and we forbid the model
 * from echoing identifiers back out (its answer becomes the embedded text; an
 * identifier in the answer is an identifier in the vector).
 */
export const FINGERPRINT_SYSTEM_PROMPT = `You are a program behaviour analyst. You are shown the source of ONE function. You describe what it OBSERVABLY DOES when it runs.

Reason ONLY about observable behaviour. These signals are misleading and you must IGNORE them completely:
- the function's name
- the names of its parameters, variables, and helpers
- comments and doc-strings
- formatting, syntax, and code style

Two functions written completely differently can do exactly the same thing. Two functions with the same name can do different things. A function called "normalizePhone" may not normalize; a function called "x" may. Judge only what the code does to its inputs when it executes.

Write for a reader who cannot see the code and never will.

Output rules:
- intent: ONE line, present tense, plain domain language, describing the observable transformation. Not the implementation, not the algorithm.
- inputs: the type of each parameter as observed ("string", "number", "string[]", "object", "unknown").
- outputs: the type(s) the function can return. Use "void" when it returns nothing.
- behavior: the ordered observable steps, each a short phrase. Describe WHAT changes about the data, not which statement does it.
- domain: one short lowercase noun for the kind of data handled, hyphenated if needed. Examples: "phone-number", "date", "currency", "email", "url", "string", "collection", "validation".
- sideEffects: everything the function changes outside its return value — I/O, network, mutation of an argument, globals, logging. Empty array when there are none.
- pure: true ONLY if the function reads nothing outside its arguments, changes nothing outside itself, and returns a value.

NEVER write an identifier taken from the code — no function names, no variable names — anywhere in your output. Name things by what they ARE, not by what the code calls them.`;

const buildUserPrompt = (fn: ExtractedFunction): string =>
  `Describe the observable behaviour of this function.\n\n\`\`\`\n${fn.body}\n\`\`\``;

/**
 * True for names that are clearly code identifiers rather than English words —
 * `normalizePhone`, `format_mobile`, `ParsePhone`. A plain lowercase word like
 * `format` is left alone: it is ordinary English and scrubbing it would mangle
 * a legitimate description.
 */
const isCompoundIdentifier = (name: string): boolean =>
  /[_$]/.test(name) || /^[a-z]+[A-Z]/.test(name) || /^[A-Z][a-z]+[A-Z]/.test(name);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Last line of defence for the no-names rule.
 *
 * The prompt tells the model not to echo identifiers; this catches it when it
 * does anyway. Only distinctive compound identifiers are removed, and only as
 * whole words, so real prose survives untouched.
 */
export const scrubIdentifier = (text: string, name: string): string => {
  if (!name || !isCompoundIdentifier(name)) return text;
  return text
    .replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

/** Strip the function's own name out of every free-text field of a fingerprint. */
const scrubFingerprint = (fingerprint: Fingerprint, name: string): Fingerprint => ({
  ...fingerprint,
  intent: scrubIdentifier(fingerprint.intent, name),
  domain: scrubIdentifier(fingerprint.domain, name),
  behavior: fingerprint.behavior.map((step) => scrubIdentifier(step, name)),
  sideEffects: fingerprint.sideEffects.map((effect) => scrubIdentifier(effect, name)),
});

export interface FingerprintBatchResult {
  /** Fingerprint per bodyHash — cached entries included. */
  byHash: Map<string, Fingerprint>;
  totalFunctions: number;
  /** Distinct bodies across the batch. */
  uniqueBodies: number;
  /** Bodies already fingerprinted before this run — these cost nothing. */
  reusedFromCache: number;
  /** Actual API calls made. The only number that costs money. */
  apiCalls: number;
  /** Bodies we could not fingerprint. They are dropped, never guessed. */
  failed: number;
}

interface FingerprintServiceDeps {
  openai?: OpenAIService;
  concurrency?: number;
}

class FingerprintService {
  private readonly openai: OpenAIService;
  private readonly concurrency: number;

  constructor({ openai = new OpenAIService(), concurrency = FINGERPRINT_CONCURRENCY }: FingerprintServiceDeps = {}) {
    this.openai = openai;
    this.concurrency = concurrency;
  }

  /** Fingerprint exactly one function. One call, one function, always. */
  async fingerprintOne(fn: ExtractedFunction): Promise<Fingerprint> {
    const fingerprint = await this.openai.structured({
      model: AppConfig.OPENAI_MODEL_CHEAP,
      name: 'fingerprint',
      schema: FingerprintSchema,
      system: FINGERPRINT_SYSTEM_PROMPT,
      user: buildUserPrompt(fn),
    });
    return scrubFingerprint(fingerprint, fn.name);
  }

  /**
   * Fingerprint a batch, keyed by body hash.
   *
   * `cached` is whatever we already have from previous runs. Anything it covers
   * costs nothing, and identical bodies within this batch collapse to a single
   * call — so a re-run of an unchanged repo makes zero API calls.
   *
   * A function that fails is dropped from the result rather than faked. It
   * simply does not participate in clustering, and the count is reported.
   */
  async fingerprintAll(
    functions: ExtractedFunction[],
    cached: ReadonlyMap<string, Fingerprint> = new Map()
  ): Promise<FingerprintBatchResult> {
    const byHash = new Map<string, Fingerprint>();
    const todo = new Map<string, ExtractedFunction>();

    for (const fn of functions) {
      const hit = cached.get(fn.bodyHash);
      if (hit) {
        byHash.set(fn.bodyHash, hit);
        continue;
      }
      // Identical bodies share a fingerprint — pay for the first one only.
      if (!todo.has(fn.bodyHash)) todo.set(fn.bodyHash, fn);
    }

    const limit = pLimit(this.concurrency);
    let failed = 0;

    const results = await Promise.all(
      [...todo].map(([hash, fn]) =>
        limit(async (): Promise<[string, Fingerprint] | null> => {
          try {
            return [hash, await this.fingerprintOne(fn)];
          } catch (err) {
            failed += 1;
            logger.warn(
              `fingerprint failed for ${fn.name} (${fn.file}:${fn.startLine}) — skipping:`,
              err instanceof Error ? err.message : err
            );
            return null;
          }
        })
      )
    );

    for (const entry of results) {
      if (entry) byHash.set(entry[0], entry[1]);
    }

    return {
      byHash,
      totalFunctions: functions.length,
      uniqueBodies: byHash.size + failed,
      reusedFromCache: byHash.size - (todo.size - failed),
      apiCalls: todo.size,
      failed,
    };
  }
}

export default FingerprintService;
