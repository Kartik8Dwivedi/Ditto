import { z } from 'zod';

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
export const guardCheckSchema = {
  body: z.object({
    owner: z.string().trim().min(1),
    name: z.string().trim().min(1),
    functions: z
      .array(
        z.object({
          name: z.string(),
          file: z.string(),
          startLine: z.number().int().nonnegative(),
          endLine: z.number().int().nonnegative(),
          signature: z.string().default(''),
          body: z.string().min(1),
          bodyHash: z.string().optional(),
          loc: z.number().int().nonnegative().optional(),
          isExported: z.boolean().default(false),
          params: z.array(z.string()).default([]),
          returnTypeText: z.string().default(''),
          imports: z.array(z.string()).default([]),
          callsExternal: z.boolean().default(false),
          isPure: z.boolean().default(false),
        })
      )
      .min(1, 'At least one function is required')
      .max(25, 'Guard checks the functions a PR adds, not a whole repo'),
  }),
};

export type GuardCheckBody = z.infer<typeof guardCheckSchema.body>;
