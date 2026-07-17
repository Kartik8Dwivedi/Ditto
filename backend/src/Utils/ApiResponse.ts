import { StatusCodes } from 'http-status-codes';
import type { Response } from 'express';

/**
 * Standardised success-response envelope so every endpoint returns the same
 * shape. Keep error responses out of here — those are produced centrally by
 * the error handler middleware.
 *
 * Shape: { success: true, message, data, meta? }
 */
export class ApiResponse<T = unknown> {
  public readonly success = true;
  public readonly message: string;
  public readonly data: T;
  public readonly meta?: unknown;

  constructor(data: T, message = 'Success', meta?: unknown) {
    this.message = message;
    this.data = data;
    if (meta !== undefined) this.meta = meta;
  }
}

export interface SendSuccessOptions<T = unknown> {
  statusCode?: number;
  data?: T;
  message?: string;
  meta?: unknown;
}

/**
 * Convenience helper to send a standardised success response.
 */
export const sendSuccess = <T = unknown>(
  res: Response,
  { statusCode = StatusCodes.OK, data, message = 'Success', meta }: SendSuccessOptions<T> = {}
): Response => res.status(statusCode).json(new ApiResponse(data ?? null, message, meta));

export default ApiResponse;
