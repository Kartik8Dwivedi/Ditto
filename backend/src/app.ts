import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import ApiRoutes from './Routes/index.js';
import AppConfig from './Config/AppConfig.js';
import { errorHandler, notFoundHandler } from './Middlewares/index.js';

/**
 * Builds and configures the Express application WITHOUT starting it. Separating
 * the app from the server (which listens) keeps the app importable in tests and
 * lets the bootstrap (index.ts) own process concerns like DB connection and
 * graceful shutdown.
 */
const createApp = (): Express => {
  const app = express();

  // Security & performance middleware (ordering matters).
  app.use(helmet());
  app.use(cors({ origin: AppConfig.CORS_ORIGIN }));
  app.use(compression());

  // Body parsers.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging — concise in production, verbose in development.
  app.use(morgan(AppConfig.IS_PRODUCTION ? 'combined' : 'dev'));

  // Global rate limiter.
  AppConfig.RateLimiter(app);

  // Liveness probe — kept outside /api and rate limiting concerns.
  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'OK', data: { uptime: process.uptime() } });
  });

  // Application routes.
  app.use('/api', ApiRoutes);

  // 404 + centralised error handling (must be registered last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
