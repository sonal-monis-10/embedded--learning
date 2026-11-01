import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import healthRouter from './routes/health.js';
import { notFound, errorHandler } from './middleware/errors.js';

// Connects to MongoDB, then builds the Express app: shared middleware first,
// then every router mounted at its path, then the error handlers.
// server.js calls this and starts listening; tests call it directly.
export async function createApp({ config, logger }) {
  await connectDatabase(config.mongo, logger);

  const app = express();

  app.disable('x-powered-by');
  // Render's proxy terminates TLS; trust it so req.ip is the real client
  // (needed for rate limiting later).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '16kb' }));

  // Routes. Each router file holds the logic; the path lives here.
  // Auth middleware is added in front of the protected routers in the next step.
  app.use('/healthz', healthRouter);

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
