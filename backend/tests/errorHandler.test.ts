import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  IS_PRODUCTION: false,
}));

vi.mock('../src/Config/AppConfig.js', () => ({
  default: mockConfig,
}));

import { errorHandler, notFoundHandler } from '../src/Middlewares/errorHandler.js';
import { AppError, NotFoundError } from '../src/Utils/AppError.js';

describe('errorHandler middleware', () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    mockConfig.IS_PRODUCTION = false;
    req = {
      method: 'GET',
      originalUrl: '/api/test',
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  it('handles CastError with 400 status', () => {
    const err = { name: 'CastError', path: '_id', value: 'invalid_id' };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fail',
        message: expect.stringContaining('_id'),
      })
    );
  });

  it('handles ValidationError with 422 status and details', () => {
    const err = {
      name: 'ValidationError',
      errors: {
        email: { message: 'Invalid email format' },
      },
    };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fail',
        details: expect.anything(),
      })
    );
  });

  it('handles duplicate key error (code 11000) with 409 status', () => {
    const err = {
      code: 11000,
      keyValue: { email: 'test@example.com' },
    };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fail',
      })
    );
  });

  it('handles body-parser JSON parse error with 400 status', () => {
    const err = {
      type: 'entity.parse.failed',
      message: 'Unexpected token in JSON',
    };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fail',
      })
    );
  });

  it('handles AppError with custom status code and details', () => {
    const details = [{ field: 'title', message: 'Required' }];
    const err = new AppError('Custom app error', 400, details);
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fail',
        message: 'Custom app error',
        details,
      })
    );
  });

  it('handles unknown/plain Error with 500 status and masked message', () => {
    const err = new Error('Sensitive internal database error');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: 'Internal server error',
      })
    );
    expect(res.json.mock.calls[0][0].message).not.toBe('Sensitive internal database error');
  });

  it('includes stack trace when IS_PRODUCTION is false', () => {
    mockConfig.IS_PRODUCTION = false;
    const err = new Error('Some error');
    errorHandler(err, req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stack: expect.any(String),
      })
    );
  });

  it('omits stack trace when IS_PRODUCTION is true', () => {
    mockConfig.IS_PRODUCTION = true;
    const err = new Error('Some error');
    errorHandler(err, req, res, next);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.stack).toBeUndefined();
  });
});

describe('notFoundHandler middleware', () => {
  it('forwards a NotFoundError to next', () => {
    const req: any = { method: 'GET', originalUrl: '/unknown-route' };
    const res: any = {};
    const next = vi.fn();

    notFoundHandler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const passedError = next.mock.calls[0][0];
    expect(passedError).toBeInstanceOf(NotFoundError);
  });
});
