import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { notFound, errorHandler } from './lib/errors.js';

// Builds the Express app without starting a server, so tests can call it
// directly with supertest.
export function createApp({ config, logger }) {
  const app = express();

  app.disable('x-powered-by');
  // Render's proxy terminates TLS; trust it so req.ip is the real client
  // (needed for rate limiting later).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '16kb' }));

  // Render's health check. Phase 1 makes this return 503 until MongoDB and
  // Mosquitto are ready.
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
