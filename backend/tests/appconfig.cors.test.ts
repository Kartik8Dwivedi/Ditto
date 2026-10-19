import { describe, expect, it, vi } from 'vitest';
import { parseCorsOrigin } from '../src/Config/cors.js';

describe('parseCorsOrigin', () => {
  it('handles standard wildcard "*"', () => {
    expect(parseCorsOrigin('*')).toBe('*');
  });

  it('handles wildcard with whitespace " * "', () => {
    expect(parseCorsOrigin(' * ')).toBe('*');
  });

  it('handles a single origin', () => {
    expect(parseCorsOrigin('https://a.com')).toEqual(['https://a.com']);
  });

  it('trims whitespace across comma-separated origins', () => {
    expect(parseCorsOrigin('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('drops trailing commas without producing empty entries', () => {
    expect(parseCorsOrigin('https://a.com,')).toEqual(['https://a.com']);
  });

  it('widens to "*" when mixed with origins and triggers warning callback', () => {
    const onWarn = vi.fn();
    const result = parseCorsOrigin('*,https://a.com, https://b.com', {
      onWarnIgnoredOrigins: onWarn,
    });

    expect(result).toBe('*');
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn).toHaveBeenCalledWith(['https://a.com', 'https://b.com']);
  });

  it('throws an error on empty string', () => {
    expect(() => parseCorsOrigin('')).toThrowError(/CORS_ORIGIN/);
  });

  it('throws an error on whitespace-only string', () => {
    expect(() => parseCorsOrigin('   ')).toThrowError(/CORS_ORIGIN/);
  });

  it('throws an error on comma-only input', () => {
    expect(() => parseCorsOrigin(',,')).toThrowError(/CORS_ORIGIN/);
    expect(() => parseCorsOrigin(' , , ')).toThrowError(/CORS_ORIGIN/);
  });
  it('does not trigger warning callback when "*" is the only entry', () => {
    const onWarn = vi.fn();
    expect(parseCorsOrigin(' * ', { onWarnIgnoredOrigins: onWarn })).toBe('*');
    expect(onWarn).not.toHaveBeenCalled();
  });
});
