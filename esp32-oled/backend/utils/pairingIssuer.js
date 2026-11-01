import { Device } from '../entity/device.js';
import { PairingCode } from '../entity/pairingCode.js';
import { publishPairing } from '../mqtt/publisher.js';
import { logger } from './logger.js';

// Keeps a valid pairing code on the OLED of every free, online device.
// A code is replaced this long before it expires, so a visitor never scans
// one that runs out while they type their name.
const REFRESH_BEFORE_EXPIRY_MS = 15_000;
const SWEEP_INTERVAL_MS = 15_000;

// Shows a code on the device if it is free and online and has no fresh one.
export async function offerPairing(deviceId) {
  const device = await Device.findById(deviceId);
  if (!device?.online || device.controller) return null;
  if (await PairingCode.findLive(deviceId, REFRESH_BEFORE_EXPIRY_MS)) return null;

  const pairing = await PairingCode.issue(deviceId);
  publishPairing(deviceId, pairing);
  return pairing;
}

// The device was taken or went offline: clear its screen and void its codes.
export async function withdrawPairing(deviceId) {
  await PairingCode.deleteMany({ device: deviceId, usedAt: null });
  publishPairing(deviceId, null);
}

// Offers a code to every free, online device. Also covers codes about to
// expire and a backend that just restarted.
export async function sweepPairing() {
  const free = await Device.find({ online: true, controller: null }, { _id: 1 });
  for (const { _id } of free) await offerPairing(_id);
}

export function schedulePairingSweep() {
  const timer = setInterval(
    () => sweepPairing().catch((err) => logger.error({ err }, 'pairing sweep failed')),
    SWEEP_INTERVAL_MS,
  ).unref();
  return () => clearInterval(timer);
}
