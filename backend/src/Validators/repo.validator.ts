import { z } from 'zod';

/** Reusable Mongo ObjectId validator. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const repoIdSchema = {
  params: z.object({ repoId: objectId }),
};

export type RepoIdParams = z.infer<typeof repoIdSchema.params>;
