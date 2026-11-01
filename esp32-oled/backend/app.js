import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import healthRouter from './routes/health.js';
import adminRouter from './routes/admin.js';
import pairingRouter from './routes/pairing.js';
import devicesRouter from './routes/devices.js';
import { requireAdmin, requireSession } from './middleware/auth.js';
import { adminKeyLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errors.js';

// Connects to MongoDB, then builds the Express app: shared middleware first,
// then every router mounted at its path, then the error handlers.
// server.js calls this and starts listening; tests call it directly.
export async function createApp({ config, logger }) {
  await connectDatabase(config.mongo, logger);

  const app = express();
  // Routers and middleware read these through req.app.locals.
  app.locals.config = config;
  app.locals.logger = logger;

  app.disable('x-powered-by');
  // Render's proxy terminates TLS; trust it so req.ip is the real client
  // (used by the rate limits).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '16kb' }));

  // Routes. Each router file holds the logic; the path and its auth live here.
  app.use('/healthz', healthRouter);
  app.use('/api/admin', adminKeyLimiter, requireAdmin, adminRouter);
  app.use('/api/devices', requireSession, devicesRouter);
  // /api/pair (no session needed), /api/me, /api/logout (session checked per route)
  app.use('/api', pairingRouter);

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}

async function connectDatabase({ uri, dbName }, logger) {
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongodb reconnected'));

  // Fail within 10 s instead of hanging when Atlas is unreachable (wrong
  // string, IP not on the access list), so the deploy shows a clear error.
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  logger.info({ dbName }, 'mongodb connected');
}

export async function closeDatabase() {
  await mongoose.disconnect();
}
