import { z } from 'zod';

/** Reusable Mongo ObjectId validator. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const createResourceSchema = {
  body: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
};

export const updateResourceSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    }),
};

export const resourceIdSchema = {
  params: z.object({ id: objectId }),
};

export const listResourceSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
};

/** Types inferred from the Zod schemas — reuse these in controllers/services. */
export type CreateResourceBody = z.infer<typeof createResourceSchema.body>;
export type UpdateResourceBody = z.infer<typeof updateResourceSchema.body>;
export type ListResourceQuery = z.infer<typeof listResourceSchema.query>;
