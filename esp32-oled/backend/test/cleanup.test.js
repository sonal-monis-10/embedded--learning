import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { Meta } from '../entity/meta.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { decrypt } from '../utils/crypto.js';
import { runCleanupIfDue } from '../utils/cleanup.js';
import { startTestApp } from './support/db.js';

let t;
const tz = 'Asia/Kolkata';

before(async () => {
  t = await startTestApp();
});

after(async () => {
  await t.stop();
});

beforeEach(async () => {
  await Meta.deleteMany({});
});

// A device with an owner, mode "eyes" and a spare pairing code.
async function busyDevice() {
  const { id, envFile } = await t.createDevice();
  const owner = await t.pair(id, { name: 'Owner' });
  await request(t.app)
    .put(`/api/devices/${id}/mode`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ mode: 'eyes' });
  await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
  return { id, envFile, owner };
}

describe('cleanup', () => {
  it('wipes people data and keeps device logins', async () => {
    const { id, envFile, owner } = await busyDevice();

    const res = await t.admin.post('/api/admin/cleanup').expect(200);
    assert.ok(res.body.users >= 1 && res.body.sessions >= 1 && res.body.pairingCodes >= 1);

    assert.equal(await User.countDocuments(), 0);
    assert.equal(await Session.countDocuments(), 0);
    assert.equal(await PairingCode.countDocuments(), 0);
    assert.equal(await DeviceEvent.countDocuments(), 0);

    const device = await Device.findById(id).select('+secret');
    assert.equal(device.name, null);
    assert.equal(device.members.length, 0);
    assert.equal(device.mode, 'idle');
    // The flashed board's secret still works: same value as in its .env.
    const secretInEnv = JSON.parse(/DEVICE_SECRET=(.*)/.exec(envFile)[1]);
    assert.equal(decrypt(device.secret, t.config.secretsKey), secretInEnv);

    // The phone has to scan again.
    await request(t.app).get('/api/me').set('Authorization', `Bearer ${owner.token}`).expect(401);
    const again = await t.pair(id, { name: 'Owner again' });
    assert.equal(again.device.role, 'owner');
  });
});

describe('runCleanupIfDue', () => {
  const day1 = new Date('2026-11-01T10:00:00Z'); // 15:30 IST, Nov 1
  const day1Late = new Date('2026-11-01T18:29:00Z'); // 23:59 IST, Nov 1
  const day2 = new Date('2026-11-01T18:31:00Z'); // 00:01 IST, Nov 2
  const day5 = new Date('2026-11-05T03:00:00Z');

  it('first start records the date and cleans nothing', async () => {
    await busyDevice();
    assert.equal(await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day1 }), null);
    assert.ok((await User.countDocuments()) > 0);
    assert.equal((await Meta.findById('cleanup')).lastRunDate, '2026-11-01');
  });

  it('runs once after midnight, not again the same day', async () => {
    await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day1 });
    await busyDevice();

    assert.equal(await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day1Late }), null);
    assert.ok((await User.countDocuments()) > 0);

    const summary = await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day2 });
    assert.ok(summary.users > 0);
    assert.equal(await User.countDocuments(), 0);
    assert.equal(await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day2 }), null);
  });

  it('catches up after days asleep, once', async () => {
    await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day1 });
    await busyDevice();
    assert.ok(await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day5 }));
    assert.equal(await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day5 }), null);
  });

  it('two checks at the same moment clean only once', async () => {
    await runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day1 });
    const results = await Promise.all([
      runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day2 }),
      runCleanupIfDue({ timeZone: tz, logger: t.logger, now: day2 }),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  });
});
