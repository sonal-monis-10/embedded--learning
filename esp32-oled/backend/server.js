import http from 'node:http';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { scheduleNightlyCleanup } from './utils/cleanup.js';
import { createApp, closeDatabase } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = await createApp().catch((err) => {
  logger.fatal(
    { err: err.message },
    'startup failed (check MONGODB_URI and the Atlas access list)',
  );
  process.exit(1);
});

const server = http.createServer(app);
server.listen(config.port, () => logger.info({ port: config.port }, 'backend listening'));

const stopCleanup = scheduleNightlyCleanup();

// Render sends SIGTERM before replacing the instance on a deploy: finish
// in-flight requests, close MongoDB, exit.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  stopCleanup();
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
