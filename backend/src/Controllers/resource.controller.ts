import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';
import type { FilterQuery } from 'mongoose';

import { ResourceService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { IResource } from '../Models/index.js';
import type {
  CreateResourceBody,
  ListResourceQuery,
  UpdateResourceBody,
} from '../Validators/resource.validator.js';

/**
 * Controllers follow a FUNCTIONAL style: each handler is a small, stateless
 * function. Their only job is HTTP concerns — read the (already validated)
 * request, delegate to the service, and shape the response. No business logic
 * and no try/catch (asyncHandler forwards rejections to the error middleware).
 *
 * One shared service instance is fine here since the service is stateless.
 *
 * `validate(...)` has already parsed and coerced the request, so the casts below
 * are the safe, documented boundary between untyped Express input and our types.
 */
const resourceService = new ResourceService();

export const createResource = async (req: Request, res: Response): Promise<void> => {
  const resource = await resourceService.create(req.body as CreateResourceBody);
  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    data: resource,
    message: 'Resource created',
  });
};

export const getResource = async (req: Request, res: Response): Promise<void> => {
  const resource = await resourceService.getById(req.params.id);
  sendSuccess(res, { data: resource });
};

export const listResources = async (req: Request, res: Response): Promise<void> => {
  const { page, limit, status } = req.query as unknown as ListResourceQuery;
  const filter: FilterQuery<IResource> = status ? { status } : {};
  const { items, meta } = await resourceService.list(filter, { page, limit });
  sendSuccess(res, { data: items, meta, message: 'Resources fetched' });
};

export const updateResource = async (req: Request, res: Response): Promise<void> => {
  const resource = await resourceService.update(req.params.id, req.body as UpdateResourceBody);
  sendSuccess(res, { data: resource, message: 'Resource updated' });
};

export const deleteResource = async (req: Request, res: Response): Promise<void> => {
  const result = await resourceService.remove(req.params.id);
  sendSuccess(res, { data: result, message: 'Resource deleted' });
};
