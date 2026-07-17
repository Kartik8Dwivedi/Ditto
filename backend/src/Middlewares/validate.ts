import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

import { ValidationError } from '../Utils/errors/AppError.js';

/** Which parts of the request to validate. Each key is an optional Zod schema. */
export interface RequestValidationSchema {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

interface ValidationIssue {
  source: string;
  path: string;
  message: string;
}

/**
 * Request validation middleware backed by Zod.
 *
 * Pass a schema object describing which parts of the request to validate.
 * Each provided key is parsed and the *parsed* (coerced/stripped) value is
 * written back onto the request, so downstream handlers receive clean data.
 */
const validate =
  (schema: RequestValidationSchema): RequestHandler =>
  (req, _res, next) => {
    const issues: ValidationIssue[] = [];

    for (const source of ['body', 'params', 'query'] as const) {
      const sourceSchema = schema[source];
      if (!sourceSchema) continue;

      const result = sourceSchema.safeParse(req[source]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ source, path: issue.path.join('.'), message: issue.message });
        }
        continue;
      }

      // Write the parsed (coerced/stripped) value back for downstream handlers.
      if (source === 'query') {
        // Express exposes req.query as a getter-only property; mutate in place.
        Object.assign(req.query, result.data);
      } else {
        Object.assign(req, { [source]: result.data });
      }
    }

    if (issues.length > 0) {
      return next(new ValidationError('Request validation failed', issues));
    }

    return next();
  };

export default validate;
