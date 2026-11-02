import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { sendToPhone } from '../live/hub.js';
import { logger } from '../utils/logger.js';
import { offerPairing, withdrawPairing } from '../utils/pairingIssuer.js';

// Turns each device's retained `status` message into its online state.
// The device publishes {"online":true,…} when it connects; the broker
// publishes its Last Will {"online":false} when it drops off.

const STATUS_TOPIC = /^d\/(oled-[a-z0-9]{6})\/status$/;
const AUTH_FAIL_LINE = /Client (oled-[a-z0-9]{6}) .*not authori[sz]ed/;
const AUTH_FAIL_THROTTLE_MS = 60_000;

const statusSchema = z.object({
  online: z.boolean(),
  fw: z.string().max(32).optional(),
  sha: z.string().max(40).optional(),
  rssi: z.number().optional(),
  ip: z.string().max(45).optional(),
});

export async function watchPresence(backendClient) {
  backendClient.on('message', (topic, payload) => {
    const deviceId = STATUS_TOPIC.exec(topic)?.[1];
    if (!deviceId || payload.length === 0) return;
    updatePresence(deviceId, payload).catch((err) =>
      logger.error({ err, deviceId }, 'presence update failed'),
    );
  });
  await backendClient.subscribeAsync('d/+/status', { qos: 1 });
}

async function updatePresence(deviceId, payload) {
  const status = statusSchema.safeParse(parseJson(payload));
  if (!status.success) return;
  const { online, fw, sha, rssi, ip } = status.data;

  const before = await Device.findOneAndUpdate(
    { _id: deviceId },
    {
      $set: {
        online,
        lastSeenAt: new Date(),
        ...(fw && { 'fw.version': fw }),
        ...(sha && { 'fw.gitSha': sha }),
        ...(rssi !== undefined && { 'net.rssi': rssi }),
        ...(ip && { 'net.ip': ip }),
      },
    },
  );
  if (!before) return; // a login for a device that was deleted

  if (before.online !== online) {
    await DeviceEvent.record(deviceId, online ? 'connect' : 'disconnect', { fw, rssi });
  }
  sendToPhone(deviceId, { t: 'status', online, mode: before.mode });

  // A free device that just came online needs a code on its screen.
  if (online) await offerPairing(deviceId);
  else await withdrawPairing(deviceId);
}

// Mosquitto logs a refused login as "Client <id> disconnected, not authorised."
const lastAuthFail = new Map();
export function noteLogLine(line) {
  const deviceId = AUTH_FAIL_LINE.exec(line)?.[1];
  if (!deviceId) return;
  const now = Date.now();
  if (now - (lastAuthFail.get(deviceId) ?? 0) < AUTH_FAIL_THROTTLE_MS) return;
  lastAuthFail.set(deviceId, now);
  Device.exists({ _id: deviceId })
    .then((known) => known && DeviceEvent.record(deviceId, 'auth_fail'))
    .catch((err) => logger.error({ err, deviceId }, 'recording auth failure failed'));
}

function parseJson(payload) {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return null;
  }
}
