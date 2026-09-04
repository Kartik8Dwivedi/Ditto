import { z } from 'zod';

import { ExtractedFunctionSchema } from '../Models/contracts.js';

/**
 * Ditto Guard's request body.
 *
 * The caller is the indexer running inside a GitHub Action, so it already has
 * the AST facts and sends the pinned `ExtractedFunction` shape. The two fields
 * that are pure functions of `body` — `bodyHash` and `loc` — are optional and
 * derived server-side, so a simpler client can still call this.
 *
 * The function cap is a cost control: Guard exists to be cheap, and a diff that
 * adds 200 functions is not a pull request we should be fingerprinting on demand.
 */
const guardFunctionSchema = ExtractedFunctionSchema.partial({
  bodyHash: true,
  loc: true,
});

export const guardCheckSchema = {
  body: z.object({
    owner: z.string().trim().min(1),
    name: z.string().trim().min(1),
    functions: z
      .array(guardFunctionSchema)
      .min(1, 'At least one function is required')
      .max(25, 'Guard checks the functions a PR adds, not a whole repo'),
  }),
};

export type GuardCheckBody = z.infer<typeof guardCheckSchema.body>;
