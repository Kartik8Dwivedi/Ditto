import createApp from './app.js';
import AppConfig from './Config/AppConfig.js';
import logger from './Config/logger.js';
import { connectToDB, disconnectFromDB } from './Config/db.js';

/**
 * Application entry point. Responsible for process-level concerns:
 *   1. connect to the database
 *   2. start the HTTP server
 *   3. shut everything down cleanly on signals / fatal errors
 */
const start = async (): Promise<void> => {
  await connectToDB();

  const app = createApp();
  const server = app.listen(AppConfig.PORT, () => {
    logger.success(`Server running on port ${AppConfig.PORT} [${AppConfig.NODE_ENV}]`);
  });

  /** Drains in-flight requests, closes the DB, then exits. */
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.warn(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await disconnectFromDB();
      logger.info('Shutdown complete.');
      process.exit(0);
    });

    // Force-exit if graceful shutdown stalls.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  // SIGINT and SIGTERM are the signals sent by Kubernetes when it wants to terminate a pod.
  (['SIGINT', 'SIGTERM'] as const).forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });

  // Last-resort safety nets for programmer errors.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
  });
};

start().catch((err: unknown) => {
  logger.error('Failed to start application:', err);
  process.exit(1);
});
