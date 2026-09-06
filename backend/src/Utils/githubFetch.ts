import { StatusCodes } from 'http-status-codes';

import AppConfig from '../Config/AppConfig.js';
import AppError from './errors/AppError.js';
import { fetchWithRetry } from './fetchWithRetry.js';

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Fetch GitHub with bounded retries and a hard wall-clock timeout. */
export const fetchGithub = async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): Promise<Response> => {
  try {
    return await fetchWithRetry(input, {
      ...init,
      signal: AbortSignal.timeout(AppConfig.GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new AppError(
        `GitHub request timed out after ${AppConfig.GITHUB_TIMEOUT_MS}ms. Retry the request; if it persists, check GitHub availability and network connectivity.`,
        StatusCodes.GATEWAY_TIMEOUT
      );
    }
    throw error;
  }
};
