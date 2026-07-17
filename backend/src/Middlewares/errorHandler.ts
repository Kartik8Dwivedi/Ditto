import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import AppError, { NotFoundError } from '../Utils/errors/AppError.js';
import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';

/**
 * 404 handler — reached when no route matched. Forwards a NotFoundError to the
 * central error handler so the response shape stays consistent.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** MongoDB duplicate-key error (unique index violation). */
const isDuplicateKeyError = (
  err: unknown
): err is { code: number; keyValue?: Record<string, unknown> } =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code: unknown }).code === 11000;

/** body-parser error raised for a malformed JSON body. */
const isBodyParseError = (err: unknown): err is { type: string } =>
  typeof err === 'object' &&
  err !== null &&
  'type' in err &&
  (err as { type: unknown }).type === 'entity.parse.failed';

/**
 * Normalises known third-party / framework errors (Mongoose, body-parser JSON)
 * into our AppError shape. Returns the original error if it is unrecognised.
 */
const normaliseError = (err: unknown): Error => {
  if (err instanceof AppError) return err;

  // Invalid ObjectId / cast failures.
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(`Invalid value for "${err.path}"`, StatusCodes.BAD_REQUEST);
  }

  // Mongoose schema validation.
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError('Validation failed', StatusCodes.UNPROCESSABLE_ENTITY, details);
  }

  // Duplicate key (unique index violation).
  if (isDuplicateKeyError(err)) {
    const fields = Object.keys(err.keyValue ?? {}).join(', ');
    return new AppError(`Duplicate value for: ${fields}`, StatusCodes.CONFLICT);
  }

  // Malformed JSON body.
  if (isBodyParseError(err)) {
    return new AppError('Malformed JSON in request body', StatusCodes.BAD_REQUEST);
  }

  return err instanceof Error ? err : new Error(String(err));
};

/**
 * Central Express error-handling middleware. Must be registered LAST and must
 * keep the 4-argument signature so Express recognises it as an error handler.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = normaliseError(err);
  const isOperational = error instanceof AppError && error.isOperational;
  const statusCode =
    error instanceof AppError ? error.statusCode : StatusCodes.INTERNAL_SERVER_ERROR;

  // Log unexpected (non-operational) errors at error level with full stack.
  if (!isOperational) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  } else {
    logger.warn(`${statusCode} on ${req.method} ${req.originalUrl}: ${error.message}`);
  }

  const body: { success: false; message: string; details?: unknown; stack?: string } = {
    success: false,
    message: isOperational ? error.message : 'Internal server error',
  };

  if (error instanceof AppError && error.details !== undefined) {
    body.details = error.details;
  }

  // Only expose stack traces outside production to aid debugging.
  const stack = err instanceof Error ? err.stack : undefined;
  if (!AppConfig.IS_PRODUCTION && stack) body.stack = stack;

  res.status(statusCode).json(body);
};

export default errorHandler;
