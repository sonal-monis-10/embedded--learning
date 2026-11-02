import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const run = promisify(execFile);
const MAX_RESTARTS = 5;
const START_TIMEOUT_MS = 10_000;

// Starts Mosquitto as a child process with a fresh config and an empty
// Dynamic Security file (MongoDB is the source of truth; logins are synced
// in afterwards). Restarts it if it crashes; gives up after MAX_RESTARTS,
// which exits the backend so Render restarts the whole container.
// `onLogLine` receives every line Mosquitto prints.
export async function startMosquitto({ onLogLine = () => {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oled-mosquitto-'));
  const dynsecPath = path.join(dir, 'dynsec.json');
  const confPath = path.join(dir, 'mosquitto.conf');

  await run(config.mqtt.ctrlBin, [
    'dynsec',
    'init',
    dynsecPath,
    'admin',
    config.mqtt.adminPassword,
  ]);
  await fs.writeFile(confPath, mosquittoConf(dynsecPath));

  let child;
  let stopping = false;
  let restarts = 0;

  const launch = () => {
    child = spawn(config.mqtt.bin, ['-c', confPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream }).on('line', (line) => {
        logger.debug({ mosquitto: line });
        onLogLine(line);
      });
    }
    child.on('exit', (code, signal) => {
      if (stopping) return;
      restarts += 1;
      logger.error({ code, signal, restarts }, 'mosquitto exited');
      if (restarts > MAX_RESTARTS) process.exit(1);
      setTimeout(launch, 1000 * restarts);
    });
  };

  launch();
  await waitForPort(config.mqtt.tcpPort, START_TIMEOUT_MS);
  logger.info({ tcpPort: config.mqtt.tcpPort, wsPort: config.mqtt.wsPort }, 'mosquitto running');

  return async function stop() {
    stopping = true;
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    await fs.rm(dir, { recursive: true, force: true });
  };
}

// Both listeners are bound to 127.0.0.1: the only way in from outside the
// container is the backend's /mqtt pipe.
function mosquittoConf(dynsecPath) {
  const { plugin, wsPort, tcpPort } = config.mqtt;
  return `per_listener_settings false
allow_anonymous false
plugin ${plugin}
plugin_opt_config_file ${dynsecPath}

listener ${wsPort} 127.0.0.1
protocol websockets

listener ${tcpPort} 127.0.0.1

max_packet_size 16384
max_keepalive 120
persistence false
log_dest stdout
log_type error
log_type warning
log_type notice
log_type information
connection_messages true
`;
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => socket.end(() => resolve(true)));
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mosquitto did not start listening on port ${port}`);
}
