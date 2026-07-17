import OpenAIService from './openai.service.js';
import logger from '../Config/logger.js';
import type { Fingerprint } from '../Models/index.js';

/**
 * Embedding — the projection into semantic space.
 *
 * 🚨 THE RULE THIS FILE EXISTS TO ENFORCE:
 * The embedded text is built from the FINGERPRINT AND NOTHING ELSE. No function
 * name. No file path. No raw code.
 *
 * This is not a style preference, it is the entire thesis. `normalizePhone` and
 * `formatMobile` do the same thing; embed their names and the vectors are pushed
 * APART by the exact syntactic signal we exist to escape. Embedding raw code
 * fails for the same reason — a Type-4 clone is BY DEFINITION same-behaviour,
 * different-syntax, so any representation that encodes syntax cannot see it.
 *
 * {@link buildEmbedText} takes a `Fingerprint` and nothing else. That is
 * deliberate: there is no parameter through which a name COULD leak in.
 *
 * ⚠️ We embed intent + domain + input/output SHAPE, and DELIBERATELY LEAVE OUT
 * the granular `behavior[]` steps. Those steps describe *how* a function does
 * its job step by step — which is exactly where two implementations of the same
 * thing diverge. Embedding them pushes divergent-but-equivalent functions apart
 * and they never cluster: measured on the four cline `truncateText`
 * implementations, including the steps gave pairwise cosine as low as 0.66, and
 * complete-linkage split them. We want to group by WHAT a function is for, then
 * let the adjudicator and prober find the differences — so the steps belong to
 * those later stages, not to the vector.
 */

/** The embeddings endpoint takes arrays; batching is free throughput. */
export const EMBED_BATCH_SIZE = 256;

/**
 * A stamp for the current embed-text recipe. Bump it whenever {@link buildEmbedText}
 * changes: embeddings are cached by bodyHash, which does not change when the
 * TEXT does, so this is the only signal that a cached embedding is stale.
 * 'v2' dropped the granular behaviour steps (see the file header / BUG 2).
 */
export const EMBED_VERSION = 'v2-purpose-shape';

/**
 * The canonical embedded string. PURPOSE and SHAPE only — never the step-by-step
 * behaviour, and never a name.
 *
 * @param fingerprint - The ONLY input. Not the function. Not its name.
 */
export const buildEmbedText = (fingerprint: Fingerprint): string => {
  const { intent, domain, inputs, outputs } = fingerprint;
  return `${intent} | domain: ${domain} | ${inputs.join(',')} -> ${outputs.join(',')}`;
};

export interface EmbeddingBatchResult {
  /** Embedding per bodyHash. */
  byHash: Map<string, number[]>;
  reusedFromCache: number;
  /** Vectors actually bought from the API. */
  embedded: number;
}

interface EmbeddingServiceDeps {
  openai?: OpenAIService;
  batchSize?: number;
}

class EmbeddingService {
  private readonly openai: OpenAIService;
  private readonly batchSize: number;

  constructor({ openai = new OpenAIService(), batchSize = EMBED_BATCH_SIZE }: EmbeddingServiceDeps = {}) {
    this.openai = openai;
    this.batchSize = batchSize;
  }

  /**
   * Embed one fingerprint per body hash, reusing anything already cached.
   *
   * Same cache key as stage 1 (`bodyHash`) for the same reason: the fingerprint
   * is a pure function of the body, and the embedding is a pure function of the
   * fingerprint.
   */
  async embedAll(
    fingerprints: ReadonlyMap<string, Fingerprint>,
    cached: ReadonlyMap<string, number[]> = new Map()
  ): Promise<EmbeddingBatchResult> {
    const byHash = new Map<string, number[]>();
    const pending: Array<{ hash: string; text: string }> = [];

    for (const [hash, fingerprint] of fingerprints) {
      const hit = cached.get(hash);
      if (hit && hit.length > 0) {
        byHash.set(hash, hit);
        continue;
      }
      pending.push({ hash, text: buildEmbedText(fingerprint) });
    }

    for (let i = 0; i < pending.length; i += this.batchSize) {
      const batch = pending.slice(i, i + this.batchSize);
      const vectors = await this.openai.embed(batch.map((item) => item.text));
      batch.forEach((item, index) => {
        const vector = vectors[index];
        if (vector) byHash.set(item.hash, vector);
      });
      logger.info(
        `embedded ${Math.min(i + batch.length, pending.length)}/${pending.length} fingerprints`
      );
    }

    return {
      byHash,
      reusedFromCache: byHash.size - pending.length,
      embedded: pending.length,
    };
  }
}

export default EmbeddingService;
