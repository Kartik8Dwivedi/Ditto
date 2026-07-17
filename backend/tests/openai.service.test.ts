import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { z } from 'zod';

import OpenAIService, { UsageMeter } from '../src/Services/openai.service.js';
import AppError from '../src/Utils/errors/AppError.js';

/**
 * The OpenAI client is mocked in every test here. Nothing in this suite may
 * ever reach the real API.
 */

const Schema = z.object({ intent: z.string(), pure: z.boolean() });

const completion = (content: string, overrides: Record<string, unknown> = {}) => ({
  choices: [{ message: { content, refusal: null }, finish_reason: 'stop', ...overrides }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

const clientWith = (create: unknown, embeddings?: unknown) =>
  ({
    chat: { completions: { create } },
    embeddings: { create: embeddings },
  }) as unknown as OpenAI;

const request = {
  model: 'test-model',
  name: 'fingerprint',
  schema: Schema,
  system: 'system',
  user: 'user',
};

describe('OpenAIService.structured', () => {
  it('returns a validated, typed object', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"trim a string","pure":true}'));
    const service = new OpenAIService({ client: clientWith(create) });

    const result = await service.structured(request);

    expect(result).toEqual({ intent: 'trim a string', pure: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('pushes the schema down as a STRICT json schema, so decoding is constrained', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"x","pure":false}'));
    await new OpenAIService({ client: clientWith(create) }).structured(request);

    const body = create.mock.calls[0][0];
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.required).toEqual(['intent', 'pure']);
  });

  it('sends no temperature or token cap, so it works on any model tier', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"x","pure":false}'));
    await new OpenAIService({ client: clientWith(create) }).structured(request);

    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.model).toBe('test-model');
  });

  it('self-heals exactly once when the model returns the wrong shape', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion('{"intent":"x"}')) // missing `pure`
      .mockResolvedValueOnce(completion('{"intent":"x","pure":true}'));

    const result = await new OpenAIService({ client: clientWith(create) }).structured(request);

    expect(result).toEqual({ intent: 'x', pure: true });
    expect(create).toHaveBeenCalledTimes(2);

    // The retry must show the model its own output and what was wrong with it.
    const retryMessages = create.mock.calls[1][0].messages;
    expect(retryMessages).toHaveLength(4);
    expect(retryMessages[2]).toEqual({ role: 'assistant', content: '{"intent":"x"}' });
    expect(retryMessages[3].content).toContain('pure');
  });

  it('throws rather than guessing when the model fails validation twice', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"x"}'));
    const service = new OpenAIService({ client: clientWith(create) });

    await expect(service.structured(request)).rejects.toThrow(AppError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws on non-JSON rather than trying to scrape it out', async () => {
    const create = vi.fn().mockResolvedValue(completion('Sure! Here is the JSON you asked for.'));
    await expect(new OpenAIService({ client: clientWith(create) }).structured(request)).rejects.toThrow(
      AppError
    );
  });

  it('retries a 429 with backoff and then succeeds', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new OpenAI.APIError(429, undefined, 'rate limited', undefined))
      .mockResolvedValueOnce(completion('{"intent":"x","pure":true}'));

    const result = await new OpenAIService({ client: clientWith(create) }).structured(request);

    expect(result.pure).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 — a bad request stays bad', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new OpenAI.APIError(400, undefined, 'model not found', undefined));

    await expect(new OpenAIService({ client: clientWith(create) }).structured(request)).rejects.toThrow(
      AppError
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('surfaces a refusal as an AppError instead of a fake result', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: null, refusal: 'I cannot help with that' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await expect(
      new OpenAIService({ client: clientWith(create) }).structured(request)
    ).rejects.toThrow(/refused/);
  });

  it('surfaces a truncated response instead of parsing half an object', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"x"', { finish_reason: 'length' }));

    await expect(
      new OpenAIService({ client: clientWith(create) }).structured(request)
    ).rejects.toThrow(/truncated/);
  });
});

describe('OpenAIService.embed', () => {
  it('returns vectors in input order even when the API does not', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
      usage: { prompt_tokens: 8 },
    });

    const vectors = await new OpenAIService({ client: clientWith(undefined, create) }).embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('makes no call at all for an empty batch', async () => {
    const create = vi.fn();
    expect(await new OpenAIService({ client: clientWith(undefined, create) }).embed([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws when the API returns a different number of vectors than inputs', async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [1] }], usage: {} });

    await expect(
      new OpenAIService({ client: clientWith(undefined, create) }).embed(['a', 'b'])
    ).rejects.toThrow(AppError);
  });
});

describe('UsageMeter', () => {
  it('accumulates the token counts the API actually reported', async () => {
    const create = vi.fn().mockResolvedValue(completion('{"intent":"x","pure":true}'));
    const service = new OpenAIService({ client: clientWith(create) });

    await service.structured(request);
    await service.structured(request);

    expect(service.usage.snapshot()['test-model']).toEqual({
      calls: 2,
      promptTokens: 200,
      completionTokens: 40,
    });
  });

  it('prices a known model and refuses to invent a price for an unknown one', () => {
    const meter = new UsageMeter();
    meter.record('gpt-5.4-nano', 1_000_000, 0);
    expect(meter.estimateUsd()).toBeCloseTo(0.2);
    expect(meter.isEstimateComplete()).toBe(true);

    meter.record('some-model-from-2027', 1_000_000, 1_000_000);
    // The unknown model contributes nothing rather than a made-up number, and
    // the estimate is flagged incomplete so it is reported as a floor.
    expect(meter.estimateUsd()).toBeCloseTo(0.2);
    expect(meter.isEstimateComplete()).toBe(false);
  });
});
