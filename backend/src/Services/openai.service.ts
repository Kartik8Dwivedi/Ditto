import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import AppConfig from '../Config/AppConfig.js';
import AppError from '../Utils/errors/AppError.js';

/**
 * The typed LLM layer. Every model call in Ditto goes through here.
 *
 * Two rules this module exists to enforce:
 *   1. Model output is a VALIDATED, TYPED object or it is an error. There is no
 *      free-text JSON parsing anywhere — the schema is pushed down to the API as
 *      a strict JSON schema so the model is constrained during decoding, and the
 *      result is Zod-validated again on the way back.
 *   2. Model ids come from AppConfig, never from here. A "model not found" 404
 *      is an env change.
 */

/** Transient-failure retry budget (429s, 5xx, connection drops). */
const MAX_TRANSIENT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;

/**
 * Per-million-token prices in USD, used ONLY to print a cost estimate at the end
 * of a pipeline run. Verified against developers.openai.com/api/docs/pricing on
 * 2026-07-17; prices move as fast as model ids do, so an unlisted model reports
 * its tokens with no cost rather than a made-up number.
 */
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-5.6-sol': { input: 5, output: 30 },
  'gpt-5.6-terra': { input: 2.5, output: 15 },
  'gpt-5.6-luna': { input: 1, output: 6 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gpt-5.4-nano-2026-03-17': { input: 0.2, output: 1.25 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export interface ModelUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Accumulates real token counts reported by the API.
 *
 * Token counts are ground truth. The USD figure derived from them is an
 * estimate and is labelled as one wherever it is displayed.
 */
export class UsageMeter {
  private readonly byModel = new Map<string, ModelUsage>();

  record(model: string, promptTokens: number, completionTokens: number): void {
    const current = this.byModel.get(model) ?? { calls: 0, promptTokens: 0, completionTokens: 0 };
    current.calls += 1;
    current.promptTokens += promptTokens;
    current.completionTokens += completionTokens;
    this.byModel.set(model, current);
  }

  snapshot(): Record<string, ModelUsage> {
    return Object.fromEntries(this.byModel);
  }

  /** Estimated spend in USD. Models with no listed price contribute 0. */
  estimateUsd(): number {
    let total = 0;
    for (const [model, usage] of this.byModel) {
      const price = PRICING_USD_PER_MTOK[model];
      if (!price) continue;
      total += (usage.promptTokens / 1_000_000) * price.input;
      total += (usage.completionTokens / 1_000_000) * price.output;
    }
    return total;
  }

  /** True when every model we billed against has a known price. */
  isEstimateComplete(): boolean {
    return [...this.byModel.keys()].every((model) => model in PRICING_USD_PER_MTOK);
  }

  reset(): void {
    this.byModel.clear();
  }
}

export interface StructuredRequest<T extends z.ZodType> {
  /** Always an AppConfig value — never a literal. */
  model: string;
  /** Schema name sent to the API; keep it stable, it is cacheable metadata. */
  name: string;
  schema: T;
  system: string;
  user: string;
}

interface OpenAIServiceDeps {
  client?: OpenAI;
  usage?: UsageMeter;
}

let sharedClient: OpenAI | null = null;

/**
 * One client for the process. `maxRetries: 0` because retry/backoff is handled
 * here, where we can tell a rate limit apart from a schema violation.
 */
const getSharedClient = (): OpenAI => {
  sharedClient ??= new OpenAI({
    apiKey: AppConfig.OPENAI_API_KEY,
    timeout: AppConfig.OPENAI_TIMEOUT_MS,
    maxRetries: 0,
  });
  return sharedClient;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 429s, 5xx, timeouts and dropped connections are worth another attempt. */
const isTransient = (err: unknown): boolean => {
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError) {
    const { status } = err;
    if (typeof status !== 'number') return false;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
};

/** Honour an explicit Retry-After when the API sends one. */
const retryAfterMs = (err: unknown): number | null => {
  if (!(err instanceof OpenAI.APIError)) return null;
  const headers = err.headers as unknown;
  let raw: string | null = null;
  if (headers instanceof Headers) {
    raw = headers.get('retry-after');
  } else if (headers && typeof headers === 'object') {
    const value = (headers as Record<string, unknown>)['retry-after'];
    raw = typeof value === 'string' ? value : null;
  }
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_BACKOFF_MS) : null;
};

/** Exponential backoff with equal jitter, so a burst of workers desynchronises. */
const backoffMs = (attempt: number, err: unknown): number => {
  const explicit = retryAfterMs(err);
  if (explicit !== null) return explicit;
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return ceiling / 2 + Math.random() * (ceiling / 2);
};

const describe = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/** Retries a transient-failing call with backoff. Non-transient errors fail fast. */
const withRetry = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) break;
      if (attempt === MAX_TRANSIENT_ATTEMPTS - 1) break;
      await sleep(backoffMs(attempt, err));
    }
  }
  throw new AppError(`OpenAI ${label} failed: ${describe(lastError)}`, StatusCodes.BAD_GATEWAY);
};

class OpenAIService {
  readonly usage: UsageMeter;
  private readonly client: OpenAI;

  constructor({ client, usage }: OpenAIServiceDeps = {}) {
    this.client = client ?? getSharedClient();
    this.usage = usage ?? new UsageMeter();
  }

  /**
   * Ask a model for one object matching `schema` and get that object back, typed.
   *
   * `zodResponseFormat` compiles the Zod schema into the strict JSON schema the
   * API enforces during decoding, so malformed output is prevented rather than
   * detected. We still validate the response: a strict schema constrains shape,
   * not semantics, and belt-and-braces here is what lets every downstream stage
   * assume its input is real.
   *
   * On a validation miss the model gets exactly one chance to self-heal with the
   * errors handed back to it. Then it throws — a stage that cannot produce valid
   * data must not silently produce approximate data.
   */
  async structured<T extends z.ZodType>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    const { model, name, schema, system, user } = request;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.complete(model, name, schema, messages);
      const parsed = this.validate(schema, raw);
      if (parsed.success) return parsed.data;

      if (attempt === 1) {
        throw new AppError(
          `OpenAI ${name} returned data that failed validation twice`,
          StatusCodes.BAD_GATEWAY,
          parsed.issues
        );
      }

      // Self-heal: show the model its own output and exactly what was wrong.
      messages.push(
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content:
            `That response did not satisfy the schema:\n${parsed.issues.join('\n')}\n` +
            `Return corrected JSON that satisfies the schema exactly.`,
        }
      );
    }

    /* c8 ignore next — the loop above always returns or throws. */
    throw new AppError(`OpenAI ${name} exhausted its attempts`, StatusCodes.BAD_GATEWAY);
  }

  /** Embeds a batch of strings, preserving input order. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = AppConfig.EMBEDDING_MODEL;

    const response = await withRetry('embeddings', () =>
      this.client.embeddings.create({ model, input: texts })
    );

    if (response.data.length !== texts.length) {
      throw new AppError(
        `OpenAI embeddings returned ${response.data.length} vectors for ${texts.length} inputs`,
        StatusCodes.BAD_GATEWAY
      );
    }

    this.usage.record(model, response.usage?.prompt_tokens ?? 0, 0);

    // The API returns an `index` per row; sort by it rather than trusting order.
    return [...response.data].sort((a, b) => a.index - b.index).map((row) => row.embedding);
  }

  /** One completion call: strict schema down, raw JSON text back. */
  private async complete<T extends z.ZodType>(
    model: string,
    name: string,
    schema: T,
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  ): Promise<string> {
    const completion = await withRetry(name, () =>
      this.client.chat.completions.create({
        model,
        messages,
        // Deliberately no temperature/max_tokens: reasoning-tier models reject
        // non-default sampling params, and this layer must stay model-agnostic.
        response_format: zodResponseFormat(schema, name),
      })
    );

    this.usage.record(
      model,
      completion.usage?.prompt_tokens ?? 0,
      completion.usage?.completion_tokens ?? 0
    );

    const choice = completion.choices[0];
    if (!choice) {
      throw new AppError(`OpenAI ${name} returned no choices`, StatusCodes.BAD_GATEWAY);
    }
    if (choice.message.refusal) {
      throw new AppError(
        `OpenAI ${name} refused: ${choice.message.refusal}`,
        StatusCodes.BAD_GATEWAY
      );
    }
    if (choice.finish_reason === 'length') {
      throw new AppError(
        `OpenAI ${name} response was truncated before the schema was satisfied`,
        StatusCodes.BAD_GATEWAY
      );
    }

    const content = choice.message.content;
    if (!content) {
      throw new AppError(`OpenAI ${name} returned an empty response`, StatusCodes.BAD_GATEWAY);
    }
    return content;
  }

  /** JSON.parse + Zod, with both failure modes flattened into readable issues. */
  private validate<T extends z.ZodType>(
    schema: T,
    raw: string
  ): { success: true; data: z.infer<T> } | { success: false; issues: string[] } {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      return { success: false, issues: [`response was not valid JSON: ${describe(err)}`] };
    }

    const result = schema.safeParse(json);
    if (result.success) return { success: true, data: result.data };

    return {
      success: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
      ),
    };
  }
}

export default OpenAIService;
