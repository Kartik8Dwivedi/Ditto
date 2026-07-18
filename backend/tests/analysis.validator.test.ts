import { describe, it, expect } from 'vitest';

import { parseGitHubUrl } from '../src/Validators/analysis.validator.js';

/**
 * parseGitHubUrl is the one piece of /analyze worth exhaustive testing: it is
 * the gate between arbitrary pasted text and a repo we will spend money to fetch.
 */
describe('parseGitHubUrl', () => {
  it('parses a plain repo URL', () => {
    expect(parseGitHubUrl('https://github.com/cline/cline')).toEqual({
      owner: 'cline',
      name: 'cline',
      ref: null,
    });
  });

  it('tolerates a trailing slash and www', () => {
    expect(parseGitHubUrl('https://www.github.com/cline/cline/')).toEqual({
      owner: 'cline',
      name: 'cline',
      ref: null,
    });
  });

  it('strips a trailing .git', () => {
    expect(parseGitHubUrl('https://github.com/facebook/react.git')).toMatchObject({
      owner: 'facebook',
      name: 'react',
    });
  });

  it('extracts the branch from a /tree/<ref> URL', () => {
    expect(parseGitHubUrl('https://github.com/actualbudget/actual/tree/master')).toEqual({
      owner: 'actualbudget',
      name: 'actual',
      ref: 'master',
    });
  });

  it('extracts the sha from a /commit/<ref> URL', () => {
    expect(parseGitHubUrl('https://github.com/o/r/commit/abc123')).toMatchObject({ ref: 'abc123' });
  });

  it('rejects a non-github host', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/o/r')).toThrow(/github\.com/i);
  });

  it('rejects text that is not a URL', () => {
    expect(() => parseGitHubUrl('cline/cline')).toThrow(/valid URL/i);
  });

  it('rejects a URL with no repo name', () => {
    expect(() => parseGitHubUrl('https://github.com/cline')).toThrow(/owner\/repo/i);
  });

  it('rejects a github site path that is not a repo', () => {
    expect(() => parseGitHubUrl('https://github.com/orgs/anthropics')).toThrow(/owner\/repo/i);
  });

  it('rejects a non-https scheme', () => {
    expect(() => parseGitHubUrl('ftp://github.com/o/r')).toThrow();
  });
});
