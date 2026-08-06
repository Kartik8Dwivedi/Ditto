import { z } from 'zod';

import { parseGitHubUrl } from './analysis.validator.js';
import { BadRequestError } from '../Utils/errors/AppError.js';
import type { PrAnalyzeInput } from '../Services/index.js';

/**
 * POST /api/v1/pr — accepts EITHER a pasted PR URL or an explicit repo triple.
 *
 * `{ url }`                       github.com/owner/repo/pull/123
 * `{ owner, name, prNumber? }`    prNumber omitted = the latest open PR
 *
 * Zod only checks the envelope shape; {@link parsePrInput} turns it into the
 * canonical `{ owner, name, prNumber? }` the service consumes (and rejects a
 * non-PR-shaped payload with a client-friendly message).
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const createPrSchema = {
  body: z.union([
    z.object({ url: z.string().trim().min(1) }),
    z.object({
      owner: z.string().trim().min(1),
      name: z.string().trim().min(1),
      prNumber: z.coerce.number().int().positive().optional(),
    }),
  ]),
};
export type CreatePrBody = z.infer<typeof createPrSchema.body>;

export const prIdSchema = {
  params: z.object({ id: objectId }),
};
export type PrIdParams = z.infer<typeof prIdSchema.params>;

/** Normalise either accepted body into the service's `{ owner, name, prNumber? }`. */
export const parsePrInput = (body: CreatePrBody): PrAnalyzeInput => {
  if ('url' in body) {
    const { owner, name, prNumber } = parseGitHubUrl(body.url);
    return { owner, name, ...(prNumber !== undefined ? { prNumber } : {}) };
  }
  if (!body.owner || !body.name) {
    throw new BadRequestError('Provide a PR url, or an owner and name.');
  }
  return {
    owner: body.owner,
    name: body.name,
    ...(body.prNumber !== undefined ? { prNumber: body.prNumber } : {}),
  };
};
