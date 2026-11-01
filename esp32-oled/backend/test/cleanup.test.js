import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { Meta } from '../entity/meta.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { runCleanupIfDue } from '../utils/cleanup.js';
import { unseal } from '../utils/secrets.js';
import { parseEnvFile, startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());
beforeEach(() => Meta.deleteMany({}));

// A device in use: an owner phone, mode "eyes" and an unused pairing code.
async function deviceInUse() {
  const { id, envFile } = await t.registerDevice();
  const owner = await t.pair(id, { name: 'Owner' });
  await t.asPhone(owner.token).put(`/api/devices/${id}/mode`).send({ mode: 'eyes' });
  await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
  return { id, envFile, ownerToken: owner.token };
}

describe('cleanup', () => {
  it('wipes people data and keeps device logins', async () => {
    const { id, envFile, ownerToken } = await deviceInUse();

    await t.admin.post('/api/admin/cleanup').expect(200);

    for (const model of [User, Session, PairingCode, DeviceEvent]) {
      assert.equal(await model.countDocuments(), 0, model.modelName);
    }
    const device = await Device.findWithSecrets(id);
    assert.equal(device.name, null);
    assert.equal(device.members.length, 0);
    assert.equal(device.mode, 'idle');
    // The flashed board's secret still matches its .env file.
    assert.equal(unseal(device.secret), parseEnvFile(envFile).DEVICE_SECRET);

    await t.asPhone(ownerToken).get('/api/me').expect(401);
    const repaired = await t.pair(id, { name: 'Owner again' });
    assert.equal(repaired.device.role, 'owner');
  });
});

describe('runCleanupIfDue', () => {
  const ist = (iso) => new Date(`${iso}+05:30`);
  const nov1 = ist('2026-11-01T15:30:00');
  const nov1BeforeMidnight = ist('2026-11-01T23:59:00');
  const nov2AfterMidnight = ist('2026-11-02T00:01:00');
  const nov5 = ist('2026-11-05T08:30:00');

  it('on the first start, records the date and cleans nothing', async () => {
    await deviceInUse();
    assert.equal(await runCleanupIfDue(nov1), null);
    assert.ok((await User.countDocuments()) > 0);
    assert.equal((await Meta.findById('cleanup')).lastRunDate, '2026-11-01');
  });

  it('runs once after midnight, not again that day', async () => {
    await runCleanupIfDue(nov1);
    await deviceInUse();

    assert.equal(await runCleanupIfDue(nov1BeforeMidnight), null);
    assert.ok((await User.countDocuments()) > 0);

    assert.ok(await runCleanupIfDue(nov2AfterMidnight));
    assert.equal(await User.countDocuments(), 0);
    assert.equal(await runCleanupIfDue(nov2AfterMidnight), null);
  });

  it('catches up once after days asleep', async () => {
    await runCleanupIfDue(nov1);
    await deviceInUse();
    assert.ok(await runCleanupIfDue(nov5));
    assert.equal(await runCleanupIfDue(nov5), null);
  });

  it('two checks at the same moment clean only once', async () => {
    await runCleanupIfDue(nov1);
    const results = await Promise.all([
      runCleanupIfDue(nov2AfterMidnight),
      runCleanupIfDue(nov2AfterMidnight),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  });
});
