import http from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel });
const app = createApp({ config, logger });
const server = http.createServer(app);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'backend listening');
});

// Render sends SIGTERM before replacing the instance on a deploy. Stop
// accepting connections, let in-flight requests finish, then exit.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
