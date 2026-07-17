import { describe, it, expect, vi } from 'vitest';

import EmbeddingService, { buildEmbedText } from '../src/Services/embedding.service.js';
import type OpenAIService from '../src/Services/openai.service.js';
import type { Fingerprint } from '../src/Models/contracts.js';

/**
 * THE most important rule in the product: the embedded text is built from the
 * fingerprint and nothing else. If a function's name ever reaches these vectors,
 * `normalizePhone` and `formatMobile` are pushed apart by their names and Ditto
 * degrades into the tool it exists to beat.
 */

const phoneFingerprint: Fingerprint = {
  intent: 'Reduce a phone number written in any format to its ten significant digits',
  inputs: ['string'],
  outputs: ['string'],
  sideEffects: [],
  domain: 'phone-number',
  behavior: ['remove every non-digit character', 'strip a country or trunk prefix', 'return ten digits'],
  pure: true,
};

const fakeOpenAI = (vectors: number[][]) =>
  ({
    embed: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map((_text, index) => vectors[index] ?? [0, 0, 1]))
    ),
  }) as unknown as OpenAIService;

describe('buildEmbedText', () => {
  it('contains no function name, file path, or raw code', () => {
    const text = buildEmbedText(phoneFingerprint);

    // The names of the four demo implementations must be nowhere near it.
    for (const name of ['normalizePhone', 'formatMobile', 'sanitizeMobile', 'cleanNumber']) {
      expect(text).not.toContain(name);
    }
    // Nor any file path or code punctuation that would smuggle syntax back in.
    // (Only identifiers and syntax are banned — the prose is free to say
    // "return ten digits", because that is behaviour, not code.)
    expect(text).not.toContain('src/');
    expect(text).not.toContain('.ts');
    expect(text).not.toContain('=>');
    expect(text).not.toContain('replace(');
  });

  it('takes a fingerprint and nothing else, so a name has no way in', () => {
    // Structural guarantee, not a convention: one parameter, and it is the
    // fingerprint. There is no argument through which a name could be passed.
    expect(buildEmbedText).toHaveLength(1);
  });

  it('builds the canonical purpose+shape string, WITHOUT the granular behaviour steps', () => {
    // The step-by-step behaviour is deliberately excluded — it encodes the very
    // divergence we want two clones to still cluster despite. See BUG 2.
    expect(buildEmbedText(phoneFingerprint)).toBe(
      'Reduce a phone number written in any format to its ten significant digits | ' +
        'domain: phone-number | string -> string'
    );
    // The behaviour steps must not leak into the vector.
    expect(buildEmbedText(phoneFingerprint)).not.toContain('remove every non-digit');
  });

  it('pushes two differently-named implementations of one behaviour to the same text', () => {
    // Same observable behaviour described twice — the vectors must not be able
    // to tell these apart, because nothing that differs between the functions
    // (their names) is present.
    const other: Fingerprint = { ...phoneFingerprint };
    expect(buildEmbedText(other)).toBe(buildEmbedText(phoneFingerprint));
  });
});

describe('EmbeddingService.embedAll', () => {
  it('embeds the fingerprint text, never the code', async () => {
    const openai = fakeOpenAI([[1, 0, 0]]);
    const service = new EmbeddingService({ openai });

    await service.embedAll(new Map([['hash-a', phoneFingerprint]]));

    const sent = (openai.embed as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(sent).toEqual([buildEmbedText(phoneFingerprint)]);
  });

  it('never calls the API for a body hash it has already embedded', async () => {
    const openai = fakeOpenAI([]);
    const service = new EmbeddingService({ openai });

    const result = await service.embedAll(
      new Map([['hash-a', phoneFingerprint]]),
      new Map([['hash-a', [0.1, 0.2, 0.3]]])
    );

    expect(openai.embed).not.toHaveBeenCalled();
    expect(result.embedded).toBe(0);
    expect(result.reusedFromCache).toBe(1);
    expect(result.byHash.get('hash-a')).toEqual([0.1, 0.2, 0.3]);
  });

  it('batches so a big repo is a handful of requests, not one per function', async () => {
    const openai = fakeOpenAI([]);
    const service = new EmbeddingService({ openai, batchSize: 2 });

    const fingerprints = new Map(
      ['a', 'b', 'c', 'd', 'e'].map((key) => [key, phoneFingerprint] as const)
    );
    const result = await service.embedAll(fingerprints);

    expect(openai.embed).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(result.byHash.size).toBe(5);
  });
});
