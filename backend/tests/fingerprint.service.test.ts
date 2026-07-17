import { describe, it, expect, vi } from 'vitest';

import FingerprintService, { scrubIdentifier } from '../src/Services/fingerprint.service.js';
import type OpenAIService from '../src/Services/openai.service.js';
import type { ExtractedFunction, Fingerprint } from '../src/Models/contracts.js';

/**
 * Stage 1 is one function per call, cached by body hash, and it must never let a
 * function's own name leak into its behavioural description.
 */

const fn = (overrides: Partial<ExtractedFunction> & { name: string; bodyHash: string }): ExtractedFunction => ({
  file: 'src/demo.ts',
  startLine: 1,
  endLine: 5,
  signature: '',
  body: 'function x() { return 1; }',
  loc: 5,
  isExported: true,
  params: [],
  returnTypeText: 'number',
  imports: [],
  callsExternal: false,
  isPure: true,
  ...overrides,
});

const fingerprint = (overrides: Partial<Fingerprint> = {}): Fingerprint => ({
  intent: 'reduce a value to canonical form',
  inputs: ['string'],
  outputs: ['string'],
  sideEffects: [],
  domain: 'string',
  behavior: ['strip characters'],
  pure: true,
  ...overrides,
});

const fakeOpenAI = (impl: (user: string) => Fingerprint) =>
  ({
    structured: vi.fn().mockImplementation((req: { user: string }) => Promise.resolve(impl(req.user))),
  }) as unknown as OpenAIService;

describe('scrubIdentifier', () => {
  it('removes a compound identifier the model echoed back', () => {
    expect(scrubIdentifier('normalizes a phone number like normalizePhone does', 'normalizePhone')).not.toContain(
      'normalizePhone'
    );
    expect(scrubIdentifier('formats via formatMobile', 'formatMobile')).not.toContain('formatMobile');
  });

  it('leaves ordinary English words alone', () => {
    // "format" is a real word; scrubbing it would mangle a legitimate description.
    expect(scrubIdentifier('format a number for display', 'format')).toBe('format a number for display');
  });
});

describe('FingerprintService', () => {
  it('sends the body and forbids names in the prompt', async () => {
    const openai = fakeOpenAI(() => fingerprint());
    await new FingerprintService({ openai }).fingerprintOne(fn({ name: 'normalizePhone', bodyHash: 'h1' }));

    const req = (openai.structured as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.name).toBe('fingerprint');
    expect(req.user).toContain('function x()');
    expect(req.system.toLowerCase()).toContain('ignore');
    expect(req.system).toContain('name');
  });

  it('scrubs the function name out of a fingerprint the model returned with it', async () => {
    const openai = fakeOpenAI(() => fingerprint({ intent: 'what normalizePhone does', behavior: ['call normalizePhone'] }));
    const result = await new FingerprintService({ openai }).fingerprintOne(
      fn({ name: 'normalizePhone', bodyHash: 'h1' })
    );

    expect(result.intent).not.toContain('normalizePhone');
    expect(result.behavior.join(' ')).not.toContain('normalizePhone');
  });

  it('never calls the API twice for the same body hash', async () => {
    const openai = fakeOpenAI(() => fingerprint());
    const service = new FingerprintService({ openai });

    const functions = [
      fn({ name: 'a', bodyHash: 'same', body: 'function a(){return 1;}' }),
      fn({ name: 'b', bodyHash: 'same', body: 'function a(){return 1;}' }),
      fn({ name: 'c', bodyHash: 'other' }),
    ];
    const result = await service.fingerprintAll(functions);

    // Two distinct hashes -> two calls, even though there are three functions.
    expect((openai.structured as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(result.apiCalls).toBe(2);
    expect(result.byHash.size).toBe(2);
  });

  it('makes ZERO calls when everything is already cached — the re-run-is-free property', async () => {
    const openai = fakeOpenAI(() => fingerprint());
    const service = new FingerprintService({ openai });

    const functions = [fn({ name: 'a', bodyHash: 'h1' }), fn({ name: 'b', bodyHash: 'h2' })];
    const cached = new Map([
      ['h1', fingerprint()],
      ['h2', fingerprint()],
    ]);
    const result = await service.fingerprintAll(functions, cached);

    expect(openai.structured).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(0);
    expect(result.reusedFromCache).toBe(2);
  });

  it('drops a function that fails rather than faking a fingerprint', async () => {
    let call = 0;
    const openai = {
      structured: vi.fn().mockImplementation(() => {
        call += 1;
        if (call === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve(fingerprint());
      }),
    } as unknown as OpenAIService;

    const result = await new FingerprintService({ openai, concurrency: 1 }).fingerprintAll([
      fn({ name: 'a', bodyHash: 'h1' }),
      fn({ name: 'b', bodyHash: 'h2' }),
    ]);

    expect(result.failed).toBe(1);
    expect(result.byHash.size).toBe(1); // the one that succeeded
  });
});
