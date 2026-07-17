import pLimit from 'p-limit';
import { z } from 'zod';

import OpenAIService from './openai.service.js';
import { MAX_CLUSTER_SIZE } from './cluster.service.js';
import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';
import { AdjudicationSchema, type DisagreementRisk } from '../Models/index.js';

/**
 * LLM STAGE 2 — equivalence adjudication.
 *
 * The flagship model runs here and ONLY here, on the handful of candidate
 * clusters that survived the deterministic prune. It is handed the full bodies
 * of ONE cluster — 2 to 5 functions, ~2k tokens — and never anything larger.
 * It never sees the repo, never sees two clusters, never sees the cross-product.
 */

/** The flagship is slower and dearer than the cheap tier; ask for less at once. */
export const ADJUDICATE_CONCURRENCY = 6;

/**
 * A single function body longer than this is not a utility, and letting one
 * through would blow the per-call token budget the whole architecture rests on.
 */
const MAX_BODY_CHARS = 6_000;

export const ADJUDICATE_SYSTEM_PROMPT = `You are a program equivalence adjudicator.

You are shown 2-5 functions that a behavioural similarity search believes do the same thing. The search works on descriptions of behaviour, so it can be wrong. Your job is to decide whether these functions REALLY are equivalent, and then to design inputs that would expose it if they are not.

Ignore names, parameter names, comments, and formatting completely. Judge only what the code does when it executes.

The candidate group comes from a similarity search that is deliberately generous, so it often includes ONE member that does a subtly different job. Your task is to find the LARGEST subset of these functions that are mutually equivalent — do not throw the whole group away because one member does not belong.

equivalentMembers — the labels (e.g. ["fn_1","fn_3"]) of the functions that are mutually equivalent: same JOB, same kind of input in, same kind of result out, EVEN IF they disagree on edge cases, handle malformed input differently, or one is more complete. Four ways to truncate a string to a length belong together even when one is buggy. A function that operates on a different shape of data — truncating a structured content array rather than a plain string, validating rather than formatting, counting words rather than characters — is a DIFFERENT JOB: leave it OUT of equivalentMembers. Include a function only when you would expect it to return the same value as the others for the same input.

sameBehavior — true when equivalentMembers has at least two members (a real clone group exists), false when it does not (no two of these do the same job).

Put every way the equivalent members differ from each other in differences[]; when those differences can change the result for some input, set disagreementRisk to 'semantic'. This is the outcome we want on a real clone cluster.

canonicalId — the implementation that should survive consolidation, and it MUST be one of equivalentMembers. Prefer the one that is most complete and most defensive about edge cases, not the shortest.

behaviorSummary: one line describing what the equivalent members do, in plain domain language, as a reader who cannot see the code would want it.

differences: concrete, observable behavioural differences between the implementations. "A strips a leading 0091, B does not" — not "A uses regex, B uses slice". If they truly differ in nothing observable, return an empty array.

disagreementRisk:
- 'none': identical observable behaviour on every input.
- 'cosmetic': they differ only in ways no caller can observe (internal style, equivalent branches).
- 'semantic': there EXIST inputs for which these implementations return different values, or one throws where another returns. This is the important verdict — a latent bug, not untidiness.

confidence: 0 to 1, how sure you are of sameBehavior. Be honest and calibrated. Below 0.75 the finding is shown to the user as a suggestion rather than a claim, which is the right outcome when you are unsure.

probeInputs: THE MOST IMPORTANT FIELD. 6 to 10 inputs chosen to make these implementations DISAGREE. Each entry is a STRING containing a JSON-encoded ARRAY OF ARGUMENTS, positionally matching the functions' parameters. For a one-parameter function called with "00919876543210", the entry is exactly: ["00919876543210"]

One typical input is enough — the happy path proves nothing. Spend everything else on edges where implementations actually diverge:
- null, empty string, whitespace-only, missing values
- leading zeros; country prefixes ("+91", "0091", "91"); embedded spaces, dashes, brackets
- unicode, emoji, combining characters, non-ASCII digits
- zero, negative numbers, very large numbers, floats where an integer is expected
- timezone and DST boundaries, leap days, month ends, year boundaries
- malformed input, and values of an unexpected type
- values just inside and just outside any length or range check you can see in the code

Choose each input because you can point at a line and say: these two take different branches here.`;

export interface AdjudicationMember {
  id: string;
  body: string;
  /** Fingerprint domain, carried through for display. Not shown to the model. */
  domain: string;
}

export interface AdjudicatedCluster {
  memberIds: string[];
  canonicalId: string;
  behaviorSummary: string;
  domain: string;
  differences: string[];
  disagreementRisk: DisagreementRisk;
  confidence: number;
  probeInputs: string[];
}

interface AdjudicateServiceDeps {
  openai?: OpenAIService;
  concurrency?: number;
}

const truncateBody = (body: string): string =>
  body.length <= MAX_BODY_CHARS
    ? body
    : `${body.slice(0, MAX_BODY_CHARS)}\n/* ...truncated, function is longer than ${MAX_BODY_CHARS} characters... */`;

/**
 * Probe inputs must be JSON arrays of arguments. Anything that is not gets
 * dropped rather than repaired — the prober applies these with spread, so a
 * malformed entry is a fabricated row waiting to happen.
 */
const sanitiseProbeInputs = (raw: string[]): string[] => {
  const seen = new Set<string>();
  for (const entry of raw) {
    try {
      const parsed: unknown = JSON.parse(entry);
      if (!Array.isArray(parsed)) continue;
      // Re-serialise so equivalent inputs collapse to one row.
      seen.add(JSON.stringify(parsed));
    } catch {
      // Not JSON — drop it.
    }
  }
  return [...seen];
};

class AdjudicateService {
  private readonly openai: OpenAIService;
  private readonly concurrency: number;

  constructor({ openai = new OpenAIService(), concurrency = ADJUDICATE_CONCURRENCY }: AdjudicateServiceDeps = {}) {
    this.openai = openai;
    this.concurrency = concurrency;
  }

  /**
   * Adjudicate ONE cluster.
   *
   * Returns null when the model says these functions are not the same thing.
   * That refusal is a feature: the similarity search proposes, the flagship
   * disposes, and a rejection is evidence the reasoning stage is doing work
   * rather than rubber-stamping.
   */
  async adjudicate(members: AdjudicationMember[]): Promise<AdjudicatedCluster | null> {
    if (members.length < 2) return null;
    if (members.length > MAX_CLUSTER_SIZE) {
      // Belt and braces: the clusterer already caps this. The flagship's context
      // staying small and constant is the property the whole design protects.
      throw new Error(
        `adjudicate received ${members.length} members; the cap is ${MAX_CLUSTER_SIZE}`
      );
    }

    // Opaque, stable labels. The model never sees ids, paths, or anything else
    // that could carry naming bias into the judgement.
    const labels = members.map((_member, index) => `fn_${index + 1}`);
    const realIdByLabel = new Map(labels.map((label, index) => [label, members[index].id]));

    // The label enums are enforced during decoding, so the model CANNOT nominate
    // a canonical or an equivalent member that is not in the cluster.
    // `equivalentMembers` is the subset the model judges mutually equivalent —
    // the similarity search is generous and often adds one near-miss, and an
    // all-or-nothing verdict would throw away the good members with it.
    const schema = AdjudicationSchema.extend({
      canonicalId: z.enum(labels as [string, ...string[]]),
      equivalentMembers: z.array(z.enum(labels as [string, ...string[]])),
    });

    const user = members
      .map((member, index) => `### ${labels[index]}\n\`\`\`\n${truncateBody(member.body)}\n\`\`\``)
      .join('\n\n');

    const result = await this.openai.structured({
      model: AppConfig.OPENAI_MODEL_FLAGSHIP,
      name: 'adjudication',
      schema,
      system: ADJUDICATE_SYSTEM_PROMPT,
      user: `Adjudicate these ${members.length} functions.\n\n${user}`,
    });

    // The equivalent subset, de-duplicated and resolved to real ids. The model
    // reports it explicitly; fall back to "all members" only if it somehow said
    // same-behaviour without naming the group.
    const equivalentIds = [
      ...new Set(
        (result.equivalentMembers.length > 0 ? result.equivalentMembers : labels)
          .map((label) => realIdByLabel.get(label))
          .filter((id): id is string => id !== undefined)
      ),
    ];

    // Fewer than two mutually-equivalent members means there is no clone here —
    // the refusal case, and a feature: the search proposed, the flagship
    // disposed. A near-miss that dragged one good pair in is dropped, not fatal.
    if (!result.sameBehavior || equivalentIds.length < 2) {
      logger.info(
        `adjudicator kept ${equivalentIds.length}/${members.length} as equivalent ` +
          `(not a cluster): ${result.behaviorSummary}`
      );
      return null;
    }

    // The canonical must be one of the members we are keeping.
    const nominated = realIdByLabel.get(result.canonicalId);
    const canonicalId = nominated && equivalentIds.includes(nominated) ? nominated : equivalentIds[0];
    const canonicalDomain = members.find((member) => member.id === canonicalId)?.domain ?? 'unknown';

    return {
      memberIds: equivalentIds,
      canonicalId,
      behaviorSummary: result.behaviorSummary,
      domain: canonicalDomain,
      differences: result.differences,
      disagreementRisk: result.disagreementRisk,
      // The schema cannot bound a number, so bound it here.
      confidence: Math.min(1, Math.max(0, result.confidence)),
      probeInputs: sanitiseProbeInputs(result.probeInputs),
    };
  }

  /**
   * Adjudicate many clusters — each still its own isolated call.
   *
   * A cluster that errors is dropped with a warning rather than taking the run
   * down: one bad group must not cost a whole repo's results.
   */
  async adjudicateAll(candidates: AdjudicationMember[][]): Promise<{
    clusters: AdjudicatedCluster[];
    rejected: number;
    failed: number;
  }> {
    const limit = pLimit(this.concurrency);
    let rejected = 0;
    let failed = 0;

    const results = await Promise.all(
      candidates.map((members) =>
        limit(async (): Promise<AdjudicatedCluster | null> => {
          try {
            const adjudicated = await this.adjudicate(members);
            if (!adjudicated) rejected += 1;
            return adjudicated;
          } catch (err) {
            failed += 1;
            logger.warn(
              'adjudication failed for a candidate cluster — skipping:',
              err instanceof Error ? err.message : err
            );
            return null;
          }
        })
      )
    );

    return {
      clusters: results.filter((cluster): cluster is AdjudicatedCluster => cluster !== null),
      rejected,
      failed,
    };
  }
}

export default AdjudicateService;
