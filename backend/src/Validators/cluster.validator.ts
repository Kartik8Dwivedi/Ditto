import { z } from 'zod';

/** Reusable Mongo ObjectId validator. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const clusterIdSchema = {
  params: z.object({ clusterId: objectId }),
};

export type ClusterIdParams = z.infer<typeof clusterIdSchema.params>;
