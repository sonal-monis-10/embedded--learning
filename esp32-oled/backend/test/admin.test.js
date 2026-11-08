import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { unseal } from '../utils/secrets.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

describe('provisioning (first boot)', () => {
  it('returns a new ID, a secret and the broker URL', async () => {
    const res = await t.firmware
      .post('/api/admin/devices')
      .send({ kind: 'hardware', display: 'sh1106', fw: { version: '0.1.0', gitSha: 'a1b2c3d' } })
      .expect(201);

    assert.match(res.body.deviceId, /^oled-[a-z0-9]{6}$/);
    assert.equal(res.body.secret.length, 43);
    assert.equal(res.body.brokerUrl, 'ws://localhost:8080/mqtt');

    const stored = await Device.findById(res.body.deviceId).select('+secret');
    assert.equal(unseal(stored.secret), res.body.secret);
    assert.equal(stored.fw.version, '0.1.0');
  });

  it('needs the provision key, not the admin key', async () => {
    const body = { kind: 'hardware', display: 'sh1106' };
    const none = await t.http.post('/api/admin/devices').send(body).expect(401);
    assert.equal(none.body.error.code, 'invalid_provision_key');
    await t.admin.post('/api/admin/devices').send(body).expect(401);
  });

  it('only registers hardware devices', async () => {
    const res = await t.firmware
      .post('/api/admin/devices')
      .send({ kind: 'simulator', display: 'ssd1306' })
      .expect(400);
    assert.match(res.body.error.message, /^kind:/);
  });
});

describe('maintenance (admin key)', () => {
  it('the provision key cannot list or delete devices', async () => {
    await t.firmware.get('/api/admin/devices').expect(401);
    const { deviceId } = await t.provision();
    await t.firmware.delete(`/api/admin/devices/${deviceId}`).expect(401);
  });

  it('lists devices and shows their events, without secrets', async () => {
    const { deviceId } = await t.provision();
    const list = await t.admin.get('/api/admin/devices').expect(200);
    assert.ok(list.body.devices.some((d) => d.id === deviceId));
    assert.ok(list.body.devices.every((d) => d.secret === undefined));

    const one = await t.admin.get(`/api/admin/devices/${deviceId}`).expect(200);
    assert.equal(one.body.events[0].type, 'provisioned');
  });

  it('releases a device and deletes one', async () => {
    const { deviceId, code } = await t.freeDevice();
    await t.pair(code);

    const released = await t.admin.post(`/api/admin/devices/${deviceId}/release`).expect(200);
    assert.equal(released.body.released, true);
    assert.equal((await Device.findById(deviceId)).controller, null);

    await t.admin.delete(`/api/admin/devices/${deviceId}`).expect(204);
    await t.admin.get(`/api/admin/devices/${deviceId}`).expect(404);
  });
});

// Last: fills the database up to the cap.
describe('device limit', () => {
  it('refuses to register beyond MAX_DEVICES', async () => {
    while ((await Device.countDocuments()) < 20) await t.provision();
    const res = await t.firmware
      .post('/api/admin/devices')
      .send({ kind: 'hardware', display: 'sh1106' })
      .expect(409);
    assert.equal(res.body.error.code, 'device_limit');
  });
});
