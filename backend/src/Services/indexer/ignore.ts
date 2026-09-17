import ignore from 'ignore';
import {
  createSuppressionMatcher,
  parsePairSuppressions,
  resolveSuppressions,
  type RawSuppressionRule,
  type SuppressionMatcher,
} from './suppression.js';
import type { ExtractedFunction } from '../../Models/contracts.js';

export interface IgnoreMatcher {
  /** True when repo-relative path matches one of the ignore patterns */
  isIgnored(repoRelativePath: string): boolean;
  /** Active parsed glob patterns */
  patterns: string[];
  suppressions: SuppressionMatcher;
}

export interface ParsedDittoConfig {
  filePatterns: string[];
  rawSuppressions: RawSuppressionRule[];
}

/**
 * Rigorously splits .dittoignore upstream:
 * - filePatterns (globs) passed exclusively to ignore()
 * - rawSuppressions passed to the pair engine
 */
export const parseDittoFile = (content?: string): ParsedDittoConfig => {
  if (!content) {
    return { filePatterns: [], rawSuppressions: [] };
  }

  const lines = content.split(/\r?\n/);
  const fileLines: string[] = [];
  const suppressionLines: string[] = [];

  let currentSection: 'files' | 'suppressions' = 'files';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Section header detection
    if (line.toLowerCase() === '[files]') {
      currentSection = 'files';
      continue;
    }
    if (line.toLowerCase() === '[suppressions]') {
      currentSection = 'suppressions';
      continue;
    }

    if (currentSection === 'files') {
      if (!line.startsWith('#')) {
        fileLines.push(line);
      }
    } else {
      suppressionLines.push(rawLine);
    }
  }

  return {
    filePatterns: fileLines,
    rawSuppressions: parsePairSuppressions(suppressionLines.join('\n')),
  };
};

/**
 * Parses raw .dittoignore file contents into clean glob patterns.
 * - Strips leading/trailing whitespace.
 * - Discards empty lines.
 * - Discards comment lines starting with '#'.
 */
export const parseIgnorePatterns = (content?: string): string[] => {
  return parseDittoFile(content).filePatterns;
};

/**
 * Creates the unified IgnoreMatcher with known functions for resolution
 */
export const createIgnoreMatcher = (
  patterns: string[],
  rawSuppressions: RawSuppressionRule[] = [],
  knownFunctions: ExtractedFunction[] = []
): IgnoreMatcher => {
  const resolution = resolveSuppressions(rawSuppressions, knownFunctions);
  const suppressionMatcher = createSuppressionMatcher(resolution);

  if (patterns.length === 0) {
    return {
      isIgnored: () => false,
      patterns: [],
      suppressions: suppressionMatcher,
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
    suppressions: suppressionMatcher,
  };
};
