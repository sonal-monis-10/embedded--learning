import http from 'node:http';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { scheduleNightlyCleanup } from './utils/cleanup.js';
import { scheduleMusicSync } from './utils/music.js';
import { schedulePairingSweep } from './utils/pairingIssuer.js';
import { scheduleIdleRelease } from './utils/turns.js';
import { createLiveServer } from './live/server.js';
import { startBroker } from './mqtt/broker.js';
import { proxyMqttUpgrade } from './mqtt/proxy.js';
import { createApp, closeDatabase } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = await createApp().catch((err) => {
  logger.fatal(
    { err: err.message },
    'startup failed (check MONGODB_URI and the Atlas access list)',
  );
  process.exit(1);
});

const stopBroker = config.mqtt.enabled
  ? await startBroker().catch((err) => {
      logger.fatal(
        { err: err.message },
        'broker failed to start (is Mosquitto installed? MQTT_ENABLED=false runs without it)',
      );
      process.exit(1);
    })
  : null;

// One public port: WebSocket upgrades are routed by path, everything else
// goes to Express.
const live = createLiveServer();
const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/live') return live.handleUpgrade(req, socket, head);
  if (pathname === '/mqtt' && stopBroker) return proxyMqttUpgrade(req, socket, head);
  socket.destroy();
});
server.listen(config.port, () => logger.info({ port: config.port }, 'backend listening'));

const stopTimers = [
  scheduleNightlyCleanup(),
  scheduleIdleRelease(),
  schedulePairingSweep(),
  scheduleMusicSync(),
];

// Render sends SIGTERM before replacing the instance on a deploy: close the
// phone sockets, finish in-flight requests, stop Mosquitto, close MongoDB.
// Devices reconnect to the new instance on their own.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  stopTimers.forEach((stop) => stop());
  live.close();
  server.close(async () => {
    await stopBroker?.();
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
