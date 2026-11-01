import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { unseal } from '../utils/secrets.js';
import { parseEnvFile, startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

describe('admin key', () => {
  it('is required on every admin route', async () => {
    for (const path of ['/api/admin/devices', '/api/admin/devices/oled-aaaaaa/env']) {
      const res = await t.http.get(path).expect(401);
      assert.equal(res.body.error.code, 'invalid_admin_key');
    }
  });

  it('must be the right one', async () => {
    await t.http.get('/api/admin/devices').set('X-Admin-Key', 'wrong').expect(401);
  });
});

describe('registering a device', () => {
  it('returns its .env file and stores only sealed secrets', async () => {
    const { id, device, envFile } = await t.registerDevice();
    const env = parseEnvFile(envFile);

    assert.equal(env.DEVICE_ID, id);
    assert.equal(env.DEVICE_SECRET.length, 43);
    assert.equal(env.BROKER_URL, 'ws://localhost:8080/mqtt');
    assert.equal(env.WIFI_PASS, 'correct horse');
    assert.equal(device.secret, undefined);
    assert.equal(device.wifi.password, undefined);

    const stored = await Device.findWithSecrets(id);
    assert.equal(unseal(stored.secret), env.DEVICE_SECRET);
  });

  it('fills in Wokwi Wi-Fi for simulators', async () => {
    const res = await t.admin
      .post('/api/admin/devices')
      .send({ kind: 'simulator', display: 'ssd1306' })
      .expect(201);
    const env = parseEnvFile(res.body.envFile);
    assert.equal(env.WIFI_SSID, 'Wokwi-GUEST');
    assert.equal(env.WIFI_PASS, '');
  });

  it('accepts an open network', async () => {
    const { envFile } = await t.registerDevice({ wifi: { ssid: 'Cafe', password: '' } });
    assert.equal(parseEnvFile(envFile).WIFI_PASS, '');
  });

  it('explains what is wrong with a bad request', async () => {
    const cases = [
      ['wifi', { kind: 'hardware', display: 'sh1106' }],
      ['display', { kind: 'simulator', display: 'sh1106' }],
      ['kind', { kind: 'toaster', display: 'sh1106' }],
      ['wifi.password', { wifi: { ssid: 'Cafe', password: 'short' } }],
      ['wifi.ssid', { wifi: { ssid: 'x'.repeat(33), password: '' } }],
    ];
    for (const [field, body] of cases) {
      const res = await t.admin
        .post('/api/admin/devices')
        .send({ kind: 'hardware', display: 'sh1106', ...body })
        .expect(400);
      assert.equal(res.body.error.code, 'invalid_request');
      assert.match(res.body.error.message, new RegExp(`^${field}:|; ${field}:`));
    }
  });
});

describe('managing devices', () => {
  it('lists devices and shows their events', async () => {
    const { id } = await t.registerDevice();

    const list = await t.admin.get('/api/admin/devices').expect(200);
    assert.ok(list.body.devices.some((d) => d.id === id));

    const one = await t.admin.get(`/api/admin/devices/${id}`).expect(200);
    assert.equal(one.body.events[0].type, 'created');
  });

  it('downloads the same .env again, uncached', async () => {
    const { id, envFile } = await t.registerDevice();
    const res = await t.admin.get(`/api/admin/devices/${id}/env`).expect(200);

    assert.match(res.headers['content-disposition'], new RegExp(`filename="${id}\\.env"`));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(parseEnvFile(res.text), parseEnvFile(envFile));
  });

  it('changes Wi-Fi', async () => {
    const { id } = await t.registerDevice();
    const res = await t.admin
      .patch(`/api/admin/devices/${id}`)
      .send({ wifi: { ssid: 'Office', password: 'office-password' } })
      .expect(200);
    assert.equal(res.body.rebuildRequired, true);

    const env = parseEnvFile((await t.admin.get(`/api/admin/devices/${id}/env`)).text);
    assert.equal(env.WIFI_SSID, 'Office');
    assert.equal(env.WIFI_PASS, 'office-password');
  });

  it('rotates the secret and keeps the Wi-Fi', async () => {
    const { id, envFile } = await t.registerDevice();
    const res = await t.admin.post(`/api/admin/devices/${id}/rotate-secret`).expect(200);
    const before = parseEnvFile(envFile);
    const after = parseEnvFile(res.body.envFile);

    assert.notEqual(after.DEVICE_SECRET, before.DEVICE_SECRET);
    assert.equal(after.WIFI_PASS, before.WIFI_PASS);
    assert.equal(res.body.device.secretVersion, 2);
  });

  it('deletes a device', async () => {
    const { id } = await t.registerDevice();
    await t.admin.delete(`/api/admin/devices/${id}`).expect(204);
    await t.admin.get(`/api/admin/devices/${id}`).expect(404);
  });

  it('issues owner pairing codes that link to the frontend', async () => {
    const { id } = await t.registerDevice();
    const res = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`).expect(201);

    assert.equal(res.body.role, 'owner');
    assert.equal(res.body.url, `http://localhost:5173/pair/${res.body.code}`);
    const lifetime = new Date(res.body.expiresAt) - Date.now();
    assert.ok(lifetime > 100_000 && lifetime <= 120_000, `lifetime ${lifetime} ms`);
  });
});
