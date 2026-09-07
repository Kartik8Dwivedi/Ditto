import picomatch from 'picomatch';

export interface IgnoreMatcher {
  /** True when repo-relative path matches one of the ignore patterns */
  isIgnored(repoRelativePath: string): boolean;
  /** Active parsed glob patterns */
  patterns: string[];
}

/**
 * Parses raw .dittoignore file contents into clean glob patterns.
 * - Strips leading/trailing whitespace.
 * - Discards empty lines.
 * - Discards comment lines starting with '#'.
 */
export const parseIgnorePatterns = (content?: string): string[] => {
  if (!content) return [];

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
};

export const createIgnoreMatcher = (patterns: string[]): IgnoreMatcher => {
  if (patterns.length === 0) {
    return {
      isIgnored: () => false,
      patterns: [],
    };
  }

  const normalizedPatterns = patterns.map((p) => (p.startsWith('/') ? p.slice(1) : p));
  const isMatch = picomatch(normalizedPatterns, { dot: true });

  return {
    isIgnored: (repoRelativePath: string): boolean => {
      const cleanPath = repoRelativePath.startsWith('/')
        ? repoRelativePath.slice(1)
        : repoRelativePath;
      return isMatch(cleanPath);
    },
    patterns: normalizedPatterns,
  };
};
