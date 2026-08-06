import { describe, it, expect } from 'vitest';

import { parseGitHubUrl } from '../src/Validators/analysis.validator.js';
import { parsePrInput } from '../src/Validators/pr.validator.js';

/**
 * The URL parser must recognise a pull-request URL and lift out its number
 * WITHOUT regressing plain repo/tree/commit parsing — 'pulls' stays a reserved
 * OWNER (github.com/pulls) while 'pull' as a repo sub-path is a real PR.
 */
describe('parseGitHubUrl — pull requests', () => {
  it('extracts the PR number from /owner/repo/pull/<n>', () => {
    expect(parseGitHubUrl('https://github.com/cline/cline/pull/12387')).toEqual({
      owner: 'cline',
      name: 'cline',
      ref: null,
      prNumber: 12387,
    });
  });

  it('still parses a plain repo URL with no PR number', () => {
    const parsed = parseGitHubUrl('https://github.com/cline/cline');
    expect(parsed).toEqual({ owner: 'cline', name: 'cline', ref: null });
    expect(parsed.prNumber).toBeUndefined();
  });

  it('still rejects the reserved /pulls site path as an owner', () => {
    expect(() => parseGitHubUrl('https://github.com/pulls/something')).toThrow();
  });
});

describe('parsePrInput', () => {
  it('accepts a PR url and yields owner/name/prNumber', () => {
    expect(parsePrInput({ url: 'https://github.com/o/r/pull/42' })).toEqual({
      owner: 'o',
      name: 'r',
      prNumber: 42,
    });
  });

  it('accepts an explicit triple, prNumber optional', () => {
    expect(parsePrInput({ owner: 'o', name: 'r' })).toEqual({ owner: 'o', name: 'r' });
    expect(parsePrInput({ owner: 'o', name: 'r', prNumber: 3 })).toEqual({
      owner: 'o',
      name: 'r',
      prNumber: 3,
    });
  });
});
