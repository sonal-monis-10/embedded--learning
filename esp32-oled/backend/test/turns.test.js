import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { recordedMessages } from '../mqtt/publisher.js';
import { offerPairing, sweepPairing, withdrawPairing } from '../utils/pairingIssuer.js';
import { recordActivity, releaseIdle } from '../utils/turns.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

const pairingMessages = (deviceId) =>
  recordedMessages().filter((m) => m.topic === `d/${deviceId}/pairing`);

describe('pairing issuer', () => {
  it('gives codes only to devices that are online and free', async () => {
    const { deviceId } = await t.provision();
    assert.equal(await offerPairing(deviceId), null, 'offline: no code');

    const pairing = await t.bringOnline(deviceId);
    assert.ok(pairing.code);
    assert.deepEqual(pairingMessages(deviceId).at(-1).payload, pairing);

    await t.pair(pairing.code);
    assert.equal(await offerPairing(deviceId), null, 'taken: no code');
  });

  it('keeps one fresh code; replaces it shortly before it expires', async () => {
    const { deviceId } = await t.freeDevice();
    assert.equal(await offerPairing(deviceId), null, 'a fresh code is already showing');

    await PairingCode.updateMany({ device: deviceId }, { expiresAt: new Date(Date.now() + 5000) });
    assert.ok(await offerPairing(deviceId), 'about to expire: replaced');
  });

  it('the sweep covers every free online device', async () => {
    const { deviceId } = await t.provision();
    await Device.updateOne({ _id: deviceId }, { online: true });
    await sweepPairing();
    assert.ok(await PairingCode.findLive(deviceId));
  });

  it('withdrawing clears the OLED and voids unused codes', async () => {
    const { deviceId, code } = await t.freeDevice();
    await withdrawPairing(deviceId);
    assert.equal(pairingMessages(deviceId).at(-1).payload, null);
    await t.http.post('/api/pair').send({ code, name: 'X' }).expect(400);
  });
});

describe('idle release', () => {
  const minutes = (n) => n * 60_000;

  it('ends turns after 10 minutes without activity, not before', async () => {
    const { deviceId, code } = await t.freeDevice();
    await t.pair(code);
    const now = Date.now();

    assert.ok(!(await releaseIdle(new Date(now + minutes(9)))).includes(deviceId));
    assert.ok((await releaseIdle(new Date(now + minutes(11)))).includes(deviceId));

    assert.equal((await Device.findById(deviceId)).controller, null);
    const event = await DeviceEvent.findOne({ device: deviceId, type: 'released' });
    assert.equal(event.meta.reason, 'idle');
    assert.ok(pairingMessages(deviceId).at(-1).payload.code, 'a new code for the next visitor');
  });

  it('activity pushes the deadline back', async () => {
    const { deviceId, code } = await t.freeDevice();
    await t.pair(code);
    await Device.updateOne(
      { _id: deviceId },
      { 'controller.lastActiveAt': new Date(Date.now() - minutes(9)) },
    );

    await recordActivity(deviceId);
    assert.ok(!(await releaseIdle(new Date(Date.now() + minutes(5)))).includes(deviceId));
  });

  it('tilt is recorded at most once every 10 seconds', async () => {
    const { deviceId, code } = await t.freeDevice();
    await t.pair(code);
    const before = (await Device.findById(deviceId)).controller.lastActiveAt;

    await recordActivity(deviceId, { tilt: true });
    const after = (await Device.findById(deviceId)).controller.lastActiveAt;
    assert.equal(after.getTime(), before.getTime(), 'just paired: no extra write');
  });
});
