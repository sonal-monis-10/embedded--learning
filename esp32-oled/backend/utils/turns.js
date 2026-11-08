import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { endTurn } from '../live/hub.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { clearMusic } from './music.js';
import { offerPairing } from './pairingIssuer.js';

// A turn is one phone controlling one device. It ends when the visitor
// leaves, signs out or pairs another device; after IDLE_RELEASE_MIN without
// activity; by an admin; or at the nightly cleanup. The device then gets a
// fresh pairing code.

const CHECK_IDLE_EVERY_MS = 60_000;
// Tilt arrives ~20 times a second; recording it once every 10 s is plenty
// for a timer measured in minutes.
const RECORD_TILT_EVERY_MS = 10_000;

// Ends the turn on `deviceId`, if there is one. `reason` is one of left,
// logout, switched, idle, admin. Returns true if it did.
export async function release(deviceId, reason) {
  const before = await Device.unclaim(deviceId);
  if (!before) return false;

  await DeviceEvent.record(deviceId, 'released', { reason });
  endTurn(deviceId, reason);
  // The next visitor starts without the last one's song.
  if (before.music) await clearMusic(deviceId);
  await offerPairing(deviceId);
  return true;
}

// Records that the controller did something (a mode change, or tilt).
export async function recordActivity(deviceId, { tilt = false } = {}) {
  const now = new Date();
  const filter = { _id: deviceId, controller: { $ne: null } };
  if (tilt) filter['controller.lastActiveAt'] = { $lt: new Date(now - RECORD_TILT_EVERY_MS) };
  await Device.updateOne(filter, { $set: { 'controller.lastActiveAt': now } });
}

// Ends every turn with no activity for IDLE_RELEASE_MIN. Returns their IDs.
export async function releaseIdle(now = new Date()) {
  const cutoff = new Date(now - config.idleReleaseMs);
  const idle = await Device.find({ 'controller.lastActiveAt': { $lt: cutoff } }, { _id: 1 });
  for (const { _id } of idle) await release(_id, 'idle');
  return idle.map((d) => d._id);
}

export function scheduleIdleRelease() {
  const timer = setInterval(
    () => releaseIdle().catch((err) => logger.error({ err }, 'idle release failed')),
    CHECK_IDLE_EVERY_MS,
  ).unref();
  return () => clearInterval(timer);
}
