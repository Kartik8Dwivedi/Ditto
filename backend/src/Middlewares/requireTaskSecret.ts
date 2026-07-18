import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

import AppConfig from '../Config/AppConfig.js';
import { ForbiddenError } from '../Utils/errors/AppError.js';

/**
 * Guards `/internal/run`, which is Cloud Tasks' target and must never be
 * callable by anyone else — it triggers paid work. The task carries a shared
 * secret in `X-Ditto-Task-Secret`; anything without an exact match is 403.
 *
 * Fails closed: if no secret is configured, the route cannot authenticate a
 * caller, so EVERY request is rejected. The comparison is constant-time so a
 * wrong secret leaks nothing about the right one through timing.
 */
const requireTaskSecret: RequestHandler = (req, _res, next) => {
  const configured = AppConfig.TASK_SECRET;
  const provided = req.get('X-Ditto-Task-Secret');

  if (!configured || !provided) return next(new ForbiddenError());

  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return next(new ForbiddenError());

  return next();
};

export default requireTaskSecret;
