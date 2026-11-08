import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { requireSession } from './middleware/auth.js';
import { errorHandler, unknownRoute } from './middleware/errors.js';
import healthRoutes from './routes/health.js';
import adminRoutes from './routes/admin.js';
import pairingRoutes from './routes/pairing.js';
import deviceRoutes from './routes/devices.js';
import musicRoutes from './routes/music.js';

// Connects to MongoDB and returns the Express app, ready to listen.
export async function createApp() {
  await connectDatabase();

  const app = express();

  // Render terminates TLS in its proxy; trust it so req.ip is the client's
  // address (the rate limits count per IP).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: '16kb' }));

  app.use('/healthz', healthRoutes);
  // Each admin route names its own key (provision or admin).
  app.use('/api/admin', adminRoutes);
  app.use('/api/devices', requireSession, deviceRoutes);
  app.use('/api/music', requireSession, musicRoutes);
  app.use('/api', pairingRoutes);

  app.use(unknownRoute);
  app.use(errorHandler);

  return app;
}

export async function closeDatabase() {
  // A deliberate close is not worth the "disconnected" warning.
  mongoose.connection.removeAllListeners('disconnected');
  await mongoose.disconnect();
}

async function connectDatabase() {
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongodb reconnected'));

  // Give up after 10 s (wrong URI, IP not on the Atlas access list) instead
  // of hanging, so a bad deploy fails with a clear error.
  await mongoose.connect(config.mongo.uri, {
    dbName: config.mongo.dbName,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ dbName: config.mongo.dbName }, 'mongodb connected');
}
