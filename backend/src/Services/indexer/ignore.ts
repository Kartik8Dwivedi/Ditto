import ignore from 'ignore';

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

  // ignore package implements official .gitignore specification
  const ig = ignore().add(patterns);

  return {
    isIgnored: (repoRelativePath: string): boolean => {
      // Normalise leading slash or relative prefix for .gitignore evaluation
      const cleanPath = repoRelativePath.replace(/^\/+/, '');
      if (!cleanPath) return false;
      return ig.ignores(cleanPath);
    },
    patterns,
  };
};
