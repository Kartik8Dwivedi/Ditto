import rateLimit from 'express-rate-limit';
import type { Express } from 'express';

/**
 * Applies a global rate limiter to the app. Tune the window/max per service or
 * lift these into env-driven config as the service grows.
 */
const rateLimiter = (app: Express): void => {
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 500, // limit each IP to 500 requests per window
    standardHeaders: true, // expose RateLimit-* headers
    legacyHeaders: false, // disable deprecated X-RateLimit-* headers
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
  app.use(limiter);
};

export default rateLimiter;
