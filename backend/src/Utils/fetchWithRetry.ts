const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const MAX_TOTAL_DELAY_MS = 5_000;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const retryAfterMs = (response: Response): number | null => {
  const value = response.headers.get('retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - Date.now());
};

const boundedDelay = (
  response: Response | null,
  attempt: number,
  totalDelayMs: number
): number | null => {
  const remaining = MAX_TOTAL_DELAY_MS - totalDelayMs;
  if (remaining <= 0) return null;

  const requested = response ? retryAfterMs(response) : null;
  const delay = requested ?? BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(delay, remaining);
};

/**
 * Fetch a remote resource with bounded retries for failures that may recover.
 * Client errors are returned immediately so callers can preserve their error semantics.
 */
export const fetchWithRetry = async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): Promise<Response> => {
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) return response;

      const delayMs = boundedDelay(response, attempt, totalDelayMs);
      if (delayMs === null) return response;
      totalDelayMs += delayMs;
      try {
        await response.body?.cancel();
      } catch {
        // The failed response is already being discarded; its cancellation is best effort.
      }
      await sleep(delayMs);
    } catch (error) {
      if (init?.signal?.aborted || isAbortError(error)) throw error;
      if (attempt === MAX_ATTEMPTS) throw error;

      const delayMs = boundedDelay(null, attempt, totalDelayMs);
      if (delayMs === null) throw error;
      totalDelayMs += delayMs;
      await sleep(delayMs);
    }
  }

  throw new Error('fetch retry loop exhausted');
};
