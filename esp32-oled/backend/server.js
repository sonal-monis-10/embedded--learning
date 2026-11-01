import http from 'node:http';
import { loadConfig } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { createApp, closeDatabase } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel });

let app;
try {
  app = await createApp({ config, logger });
} catch (err) {
  // Usually a wrong MONGODB_URI or the IP missing from the Atlas access list.
  logger.fatal({ err: err.message }, 'startup failed');
  process.exit(1);
}

const server = http.createServer(app);
server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'backend listening');
});

// Render sends SIGTERM before replacing the instance on a deploy. Stop
// accepting connections, let in-flight requests finish, close MongoDB, exit.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
