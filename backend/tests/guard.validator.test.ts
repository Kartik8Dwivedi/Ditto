import { describe, it, expect } from 'vitest';

import { guardCheckSchema } from '../src/Validators/guard.validator.js';
import type { ExtractedFunction } from '../src/Models/contracts.js';

// A valid, fully-specified extracted function fixture for testing guard check validation.
const makeValidFunction = (overrides: Partial<ExtractedFunction> = {}): ExtractedFunction => ({
  name: 'calculateTotal',
  file: 'src/billing/calc.ts',
  startLine: 10,
  endLine: 25,
  signature: 'function calculateTotal(items: Item[]): number',
  body: 'function calculateTotal(items) { return items.reduce((a, b) => a + b.price, 0); }',
  bodyHash: 'abc123def456',
  loc: 15,
  isExported: true,
  params: ['items'],
  returnTypeText: 'number',
  imports: ['./types.js'],
  callsExternal: false,
  isPure: true,
  language: 'ts',
  ...overrides,
});

describe('guardCheckSchema.body', () => {
  describe('function cap guardrail (cost control)', () => {
    it('accepts a valid body with 1 function', () => {
      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions: [makeValidFunction()],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.functions).toHaveLength(1);
        expect(result.data.owner).toBe('test-owner');
        expect(result.data.name).toBe('test-repo');
      }
    });

    it('accepts a valid body at the boundary with exactly 25 functions', () => {
      const functions = Array.from({ length: 25 }, (_, i) =>
        makeValidFunction({ name: `fn_${i}` })
      );

      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.functions).toHaveLength(25);
      }
    });

    it('rejects a body with 26 functions with the cost guardrail message', () => {
      const functions = Array.from({ length: 26 }, (_, i) =>
        makeValidFunction({ name: `fn_${i}` })
      );

      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['functions']);
        expect(issues[0].message).toBe('Guard checks the functions a PR adds, not a whole repo');
      }
    });

    it('rejects an empty functions array', () => {
      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('functions'));
        expect(issue?.message).toBe('At least one function is required');
      }
    });
  });

  describe('optional fields and defaults', () => {
    it('allows omitting optional per-function fields (bodyHash, loc) and applies language default', () => {
      // Caller sends a function without bodyHash, loc, language, or preamble
      const fnWithoutOptionals = {
        name: 'minimalFn',
        file: 'src/minimal.ts',
        startLine: 1,
        endLine: 5,
        signature: 'function minimalFn(): void',
        body: 'function minimalFn() {}',
        isExported: false,
        params: [],
        returnTypeText: 'void',
        imports: [],
        callsExternal: false,
        isPure: true,
      };

      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions: [fnWithoutOptionals],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const parsedFn = result.data.functions[0];
        expect(parsedFn.bodyHash).toBeUndefined();
        expect(parsedFn.loc).toBeUndefined();
        expect(parsedFn.language).toBe('ts');
      }
    });

    it('preserves bodyHash and loc when explicitly provided', () => {
      const fn = makeValidFunction({
        bodyHash: 'custom-sha256-hash',
        loc: 42,
        language: 'python',
      });

      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions: [fn],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const parsedFn = result.data.functions[0];
        expect(parsedFn.bodyHash).toBe('custom-sha256-hash');
        expect(parsedFn.loc).toBe(42);
        expect(parsedFn.language).toBe('python');
      }
    });
  });

  describe('malformed body validation', () => {
    it('rejects a body missing required top-level fields', () => {
      expect(
        guardCheckSchema.body.safeParse({
          name: 'test-repo',
          functions: [makeValidFunction()],
        }).success
      ).toBe(false);

      expect(
        guardCheckSchema.body.safeParse({
          owner: 'test-owner',
          functions: [makeValidFunction()],
        }).success
      ).toBe(false);

      expect(
        guardCheckSchema.body.safeParse({
          owner: 'test-owner',
          name: 'test-repo',
        }).success
      ).toBe(false);
    });

    it('rejects empty or whitespace-only owner or repo name', () => {
      expect(
        guardCheckSchema.body.safeParse({
          owner: '   ',
          name: 'test-repo',
          functions: [makeValidFunction()],
        }).success
      ).toBe(false);

      expect(
        guardCheckSchema.body.safeParse({
          owner: 'test-owner',
          name: '',
          functions: [makeValidFunction()],
        }).success
      ).toBe(false);
    });

    it('rejects a function missing required AST fields', () => {
      const invalidFn = {
        name: 'broken',
        // file is missing
        startLine: 1,
        endLine: 5,
        signature: 'broken()',
        body: 'function broken() {}',
        isExported: true,
        params: [],
        returnTypeText: 'void',
        imports: [],
        callsExternal: false,
        isPure: true,
      };

      const result = guardCheckSchema.body.safeParse({
        owner: 'test-owner',
        name: 'test-repo',
        functions: [invalidFn],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.join('.') === 'functions.0.file')
        ).toBe(true);
      }
    });
  });
});
