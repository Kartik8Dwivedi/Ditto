import mongoose from 'mongoose';
import type { Connection } from 'mongoose';

import logger from './logger.js';
import AppConfig from './AppConfig.js';

/**
 * Establish the MongoDB connection. Throws on failure so the caller (bootstrap)
 * can decide how to react — we deliberately do NOT call process.exit() here to
 * keep this module side-effect-free and testable.
 */
export const connectToDB = async (): Promise<Connection> => {
  mongoose.connection.on('connected', () => logger.success('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(AppConfig.MONGO_URI);
  return mongoose.connection;
};

/** Cleanly close the MongoDB connection (used during graceful shutdown). */
export const disconnectFromDB = async (): Promise<void> => {
  await mongoose.connection.close();
};

export default connectToDB;
