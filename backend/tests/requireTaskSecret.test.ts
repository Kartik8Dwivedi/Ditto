import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Request, Response } from 'express';

/**
 * /internal/run triggers paid work, so its guard is a security boundary: only a
 * request carrying the exact shared secret may pass, and an unconfigured secret
 * must fail closed.
 */
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { TASK_SECRET: 'right-secret' as string | undefined },
}));
vi.mock('../src/Config/AppConfig.js', () => ({ default: mockConfig }));

import requireTaskSecret from '../src/Middlewares/requireTaskSecret.js';
import { ForbiddenError } from '../src/Utils/errors/AppError.js';

const invoke = (header?: string) => {
  const req = { get: vi.fn().mockReturnValue(header) } as unknown as Request;
  const next = vi.fn();
  requireTaskSecret(req, {} as Response, next);
  return next;
};

describe('requireTaskSecret', () => {
  beforeEach(() => {
    mockConfig.TASK_SECRET = 'right-secret';
  });

  it('passes a request carrying the correct secret', () => {
    const next = invoke('right-secret');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toHaveLength(0); // next() with no error
  });

  it('rejects a wrong secret with 403', () => {
    const next = invoke('wrong-secret');
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('rejects a missing header with 403', () => {
    const next = invoke(undefined);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('fails closed when no secret is configured', () => {
    mockConfig.TASK_SECRET = undefined;
    const next = invoke('anything');
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});
