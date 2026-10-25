export interface ParseCorsOriginOptions {
  onWarnIgnoredOrigins?: (ignored: string[]) => void;
}

/**
 * Normalises and validates a raw CORS_ORIGIN environment string.
 *
 * Rules:
 * - Splits entries by comma and trims whitespace.
 * - Drops trailing or intermediate empty tokens.
 * - Rejects empty inputs or strings with only commas/spaces.
 * - If '*' is present alongside other origins, widens to '*' to allow all origins,
 *   and notifies via `onWarnIgnoredOrigins` so discarded entries are not silent.
 * - Otherwise returns an array of trimmed origin strings.
 */
export function parseCorsOrigin(
  raw: string,
  options?: ParseCorsOriginOptions
): '*' | string[] {
  const entries = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (entries.length === 0) {
    throw new Error('CORS_ORIGIN must contain at least one valid origin or "*".');
  }

  if (entries.includes('*')) {
    const ignored = entries.filter((o) => o !== '*');
    if (ignored.length > 0 && options?.onWarnIgnoredOrigins) {
      options.onWarnIgnoredOrigins(ignored);
    }
    return '*';
  }

  return entries;
}
