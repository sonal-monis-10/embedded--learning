import mqtt from 'mqtt';
import { Device } from '../entity/device.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { unseal } from '../utils/secrets.js';
import { createDynsec } from './dynsec.js';
import { useDynsec } from './logins.js';
import { noteLogLine, watchPresence } from './presence.js';
import { publishMode, usePublisher } from './publisher.js';
import { startMosquitto } from './supervisor.js';

// 'off' when MQTT is disabled or not started, 'starting', then 'ready'.
let state = 'off';
export const brokerState = () => state;

// Starts Mosquitto inside this container and connects the backend to it:
//   1. Mosquitto with an empty login list
//   2. the admin client recreates every login from MongoDB
//   3. the backend client starts publishing and watching device status
// Returns a function that stops all of it.
export async function startBroker() {
  state = 'starting';
  const stopMosquitto = await startMosquitto({ onLogLine: noteLogLine });

  const admin = await connect('admin', config.mqtt.adminPassword);
  const dynsec = await createDynsec(admin);
  await syncLogins(dynsec);
  useDynsec(dynsec);

  const backend = await connect('backend', config.mqtt.backendPassword);
  usePublisher({
    publish(topic, payload, { retain = false, qos = 1 } = {}) {
      // An empty retained message clears what the device shows.
      const body = payload === null ? '' : JSON.stringify(payload);
      backend.publish(topic, body, { retain, qos });
    },
  });

  // Mosquitto starts empty, so nothing is online until devices reconnect.
  await Device.updateMany({}, { $set: { online: false } });
  await watchPresence(backend);
  for (const device of await Device.find({}, { mode: 1 })) publishMode(device._id, device.mode);

  state = 'ready';
  logger.info('broker ready');

  return async function stopBroker() {
    state = 'off';
    await Promise.all([backend.endAsync(), admin.endAsync()]);
    await stopMosquitto();
  };
}

async function syncLogins(dynsec) {
  await dynsec.createRoles();
  await dynsec.createClient('backend', config.mqtt.backendPassword, 'backend');
  const devices = await Device.find().select('+secret');
  for (const device of devices) {
    let secret;
    try {
      secret = unseal(device.secret);
    } catch {
      // Sealed under another SECRETS_KEY. Skip it rather than keep every
      // other device offline; deleting it lets the board register again.
      logger.warn({ deviceId: device._id }, 'device secret unreadable, skipping its login');
      continue;
    }
    await dynsec.createClient(device._id, secret, 'device');
  }
  logger.info({ devices: devices.length }, 'broker logins synced');
}

function connect(username, password) {
  return mqtt.connectAsync(`mqtt://127.0.0.1:${config.mqtt.tcpPort}`, {
    username,
    password,
    clientId: `${username}-${process.pid}`,
    reconnectPeriod: 1000,
  });
}
