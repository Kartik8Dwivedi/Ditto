import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An async Express handler whose rejected promise should be forwarded to `next`. */
export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so that any rejected promise is forwarded to
 * Express's error-handling middleware via `next(err)`. This removes the need
 * for a try/catch in every controller.
 *
 * Usage: router.get('/', asyncHandler(getAll));
 */
const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
