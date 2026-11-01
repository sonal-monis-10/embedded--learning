import { Device, NIGHTLY_RESET } from '../entity/device.js';
import { User } from '../entity/user.js';
import { Session } from '../entity/session.js';
import { PairingCode } from '../entity/pairingCode.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { Meta } from '../entity/meta.js';
import { dateIn } from './time.js';

const CHECK_EVERY_MS = 60_000;

// Deletes all people data and keeps device logins (docs/plan/README.md §4.4).
export async function runCleanup({ logger, reason }) {
  const [users, sessions, codes, events, devices] = await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    PairingCode.deleteMany({}),
    DeviceEvent.deleteMany({}),
    Device.updateMany({}, { $set: NIGHTLY_RESET }),
  ]);
  // Mosquitto step: also delete every browser MQTT login (s-*) and user role.

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

// Runs the cleanup once per calendar day in `timeZone`. The date of the last
// run is stored in MongoDB, so a cleanup missed while Render's free instance
// was asleep at midnight happens as soon as it wakes. Returns the summary,
// or null when nothing was due.
export async function runCleanupIfDue({ timeZone, logger, now = new Date() }) {
  const today = dateIn(timeZone, now);

  // Atomically claim today's run: only matches if the stored date differs.
  // On the very first start there is no record yet; that inserts today's
  // date and skips, since there is nothing to clean.
  let previous;
  try {
    previous = await Meta.findOneAndUpdate(
      { _id: 'cleanup', lastRunDate: { $ne: today } },
      { $set: { lastRunDate: today } },
      { upsert: true },
    );
  } catch (err) {
    // Duplicate key: the record exists and already says today. Nothing due.
    if (err.code === 11000) return null;
    throw err;
  }
  if (!previous) return null;

  return runCleanup({ logger, reason: `nightly (missed since ${previous.lastRunDate})` });
}

// Checks every minute whether today's cleanup is due. Returns a stop function.
export function startCleanupSchedule({ timeZone, logger }) {
  const tick = () =>
    runCleanupIfDue({ timeZone, logger }).catch((err) =>
      logger.error({ err }, 'scheduled cleanup failed'),
    );
  tick();
  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
