import { describe, it, expect } from 'vitest';
import {
  buildPairKey,
  resolveSuppressions,
  createSuppressionMatcher,
  MIN_HASH_PREFIX_LENGTH,
} from '../src/Services/indexer/suppression.js';
import { parseDittoFile } from '../src/Services/indexer/ignore.js';
import type { ExtractedFunction } from '../src/Models/contracts.js';

const mockFn = (name: string, file: string, bodyHash: string): ExtractedFunction => ({
  name,
  file,
  startLine: 1,
  endLine: 10,
  signature: `${name}()`,
  body: `function ${name}() {}`,
  bodyHash,
  loc: 10,
  isExported: true,
  params: [],
  returnTypeText: 'void',
  imports: [],
  callsExternal: false,
  isPure: true,
  language: 'ts',
});

const HASH_TRUNCATE_A = 'e434559c8e9a1b88a0b4537b816ff972d176f1f11fd15cdb803cd26e4b8ed339';
const HASH_SHORTEN_B = '41cf18cc268b48dc4227b26b4020a425ad5b7e39fa7ad3ca05b833a431bb4b8e';
const HASH_CLAMP_WORKER = 'bdf7da938a5318fc11080fcba0b9711aa9cb2418befe258ba153110ef21a088f';
const HASH_CLAMP_MAIN = '593e717d112e99391eec9657a4ef77575ad5c0f6c5788ff84bc08ce202e2ccaf';
const HASH_NORMALIZE_PHONE = '74b94f19953a8b27db55d77754c5471a428671cab1e1b4f628038078f1aa3f66';

describe('Per-Pair Suppression Engine', () => {
  describe('buildPairKey (commutativity)', () => {
    it('is strictly commutative and order-independent', () => {
      const prefixA = 'e434559c8e9a';
      const prefixB = '41cf18cc268b';
      const k1 = buildPairKey(prefixA, prefixB);
      const k2 = buildPairKey(prefixB, prefixA);
      expect(k1).toBe(k2);
      expect(k1).toBe('41cf18cc268b:e434559c8e9a');
    });

    it('normalizes uppercase and surrounding whitespace', () => {
      expect(buildPairKey('  E434559C8E9A  ', '41cf18cc268b')).toBe('41cf18cc268b:e434559c8e9a');
    });
  });

  describe('parseDittoFile and parsePairSuppressions', () => {
    it('isolates [suppressions] before feeding path patterns to ignore package', () => {
      const content = `
        # Global ignores
        dist/**
        *.log

        [suppressions]
        # Intentional duplicate
        e434559c8e9a1b88:41cf18cc268b48dc # reason: shim worker
        bdf7da938a53 593e717d112e # space separated
      `;

      const parsed = parseDittoFile(content);
      expect(parsed.filePatterns).toEqual(['dist/**', '*.log']);
      expect(parsed.rawSuppressions).toHaveLength(2);
      expect(parsed.rawSuppressions[0].rawHashA).toBe('e434559c8e9a1b88');
      expect(parsed.rawSuppressions[0].rawHashB).toBe('41cf18cc268b48dc');
      expect(parsed.rawSuppressions[0].reason).toBe('reason: shim worker');
      expect(parsed.rawSuppressions[1].rawHashA).toBe('bdf7da938a53');
      expect(parsed.rawSuppressions[1].rawHashB).toBe('593e717d112e');
    });

    it('treats files without sections as pure path ignore rules (backward compatible)', () => {
      const content = `
        vendor/**
        legacy/*.ts
      `;
      const parsed = parseDittoFile(content);
      expect(parsed.filePatterns).toEqual(['vendor/**', 'legacy/*.ts']);
      expect(parsed.rawSuppressions).toEqual([]);
    });
  });

  describe('Prefix Validation & Ambiguity Detection (Honesty Rails)', () => {
    it('rejects prefixes shorter than MIN_HASH_PREFIX_LENGTH (12 chars)', () => {
      const rawRules = [{ rawHashA: 'e434559c8e9', rawHashB: '41cf18cc268b' }];
      const result = resolveSuppressions(rawRules, []);
      expect(result.invalidRules).toHaveLength(1);
      expect(result.invalidRules[0].error).toContain(`at least ${MIN_HASH_PREFIX_LENGTH}`);
    });

    it('detects ambiguity when a prefix matches multiple distinct hashes in the codebase', () => {
      // Two distinct functions in the repo whose SHA-256 hashes happen to share the first 12 chars
      const collisionHash1 = 'bdf7da938a5318fc11080fcba0b9711aa9cb2418befe258ba153110ef21a088f';
      const collisionHash2 = 'bdf7da938a53ef2941097acdb0183141fca9b1287cba159012cd4150821b0179';

      const fns = [
        mockFn('fnA1', 'src/worker/clamp.ts', collisionHash1),
        mockFn('fnA2', 'src/ui/clamp.ts', collisionHash2),
        mockFn('fnB', 'src/utils/phone.ts', HASH_NORMALIZE_PHONE),
      ];

      // Prefix bdf7da938a53 matches both collisionHash1 and collisionHash2
      const rawRules = [{ rawHashA: 'bdf7da938a53', rawHashB: '74b94f19953a' }];
      const result = resolveSuppressions(rawRules, fns);

      expect(result.ambiguities).toHaveLength(1);
      expect(result.ambiguities[0].prefix).toBe('bdf7da938a53');
      expect(result.ambiguities[0].matchingHashes).toContain(collisionHash1);
      expect(result.ambiguities[0].matchingHashes).toContain(collisionHash2);
      expect(result.activeRules).toHaveLength(0); // Never silent match
    });

    it('correctly associates multiple functions sharing the exact same bodyHash (Type-1 clones)', () => {
      // Two identical functions with exact same bodyHash
      const fns = [
        mockFn('workerClamp', 'src/worker.ts', HASH_CLAMP_WORKER),
        mockFn('uiClamp', 'src/ui.ts', HASH_CLAMP_WORKER),
        mockFn('mainClamp', 'src/main.ts', HASH_CLAMP_MAIN),
      ];

      const rawRules = [
        {
          rawHashA: 'bdf7da938a53',
          rawHashB: '593e717d112e',
          reason: 'intentional clamp duplicate',
        },
      ];
      const result = resolveSuppressions(rawRules, fns);

      expect(result.activeRules).toHaveLength(1);
      const rule = result.activeRules[0];
      expect(rule.functionsA).toHaveLength(2);
      expect(rule.functionsA?.map((f) => f.file)).toEqual(['src/worker.ts', 'src/ui.ts']);

      const matcher = createSuppressionMatcher(result);
      expect(matcher.isPairSuppressed(HASH_CLAMP_WORKER, HASH_CLAMP_MAIN)).toBe(true);
      expect(matcher.isPairSuppressed(HASH_CLAMP_MAIN, HASH_CLAMP_WORKER)).toBe(true);
      expect(matcher.getSuppression(HASH_CLAMP_WORKER, HASH_CLAMP_MAIN)?.reason).toBe(
        'intentional clamp duplicate'
      );
    });
  });

  describe('Auto-Expiry on Mutation', () => {
    it('invalidates suppression if either function body is modified', () => {
      const fns = [
        mockFn('truncate', 'src/util/str.ts', HASH_TRUNCATE_A),
        mockFn('shorten', 'src/pr/new.ts', HASH_SHORTEN_B),
      ];

      const rawRules = [{ rawHashA: 'e434559c8e9a', rawHashB: '41cf18cc268b' }];
      const resolution = resolveSuppressions(rawRules, fns);
      const matcher = createSuppressionMatcher(resolution);

      expect(matcher.isPairSuppressed(HASH_TRUNCATE_A, HASH_SHORTEN_B)).toBe(true);

      // Mutated body leads to a different hash
      const mutatedHashA = HASH_CLAMP_WORKER;
      expect(matcher.isPairSuppressed(mutatedHashA, HASH_SHORTEN_B)).toBe(false);
    });
  });
});
