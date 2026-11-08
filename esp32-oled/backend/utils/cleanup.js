import { Device, NIGHTLY_RESET } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { Meta } from '../entity/meta.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { endAllTurns } from '../live/hub.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { clearAllMusic } from './music.js';
import { sweepPairing } from './pairingIssuer.js';
import { dateIn } from './time.js';

const CHECK_INTERVAL_MS = 60_000;

// Deletes everything about people and keeps device logins, so flashed boards
// keep connecting and everyone simply pairs again.
export async function runCleanup(reason) {
  endAllTurns('midnight');
  await clearAllMusic();
  const [users, sessions, codes, events, devices] = await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    PairingCode.deleteMany({}),
    DeviceEvent.deleteMany({}),
    Device.updateMany({}, { $set: NIGHTLY_RESET }),
  ]);
  // Every device is free now: put fresh codes on the online ones.
  await sweepPairing();

  const summary = {
    users: users.deletedCount,
    sessions: sessions.deletedCount,
    pairingCodes: codes.deletedCount,
    events: events.deletedCount,
    devicesReset: devices.modifiedCount,
  };
  logger.info({ reason, ...summary }, 'cleanup done');
  return summary;
}

// Runs the cleanup at most once per calendar day. The date of the last run is
// stored, so a midnight missed while Render's free instance slept is caught
// up on the next check. Returns the summary, or null if nothing was due.
export async function runCleanupIfDue(now = new Date()) {
  const today = dateIn(config.cleanupTimeZone, now);
  const record = await Meta.findById('cleanup');

  if (!record) {
    await startTracking(today);
    return null;
  }
  if (record.lastRunDate === today) return null;

  // Only one concurrent check may win: the update matches only while the
  // stored date is still the one we read.
  const claimed = await Meta.updateOne(
    { _id: 'cleanup', lastRunDate: record.lastRunDate },
    { $set: { lastRunDate: today } },
  );
  if (claimed.modifiedCount === 0) return null;

  return runCleanup(`nightly, last run ${record.lastRunDate}`);
}

// Checks every minute. Returns a function that stops the checks.
export function scheduleNightlyCleanup() {
  const check = () =>
    runCleanupIfDue().catch((err) => logger.error({ err }, 'nightly cleanup failed'));

  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS).unref();
  return () => clearInterval(timer);
}

// First start on a new database: nothing to clean yet, just remember today.
async function startTracking(today) {
  try {
    await Meta.create({ _id: 'cleanup', lastRunDate: today });
  } catch (err) {
    const anotherCheckWon = err.code === 11000;
    if (!anotherCheckWon) throw err;
  }
}
