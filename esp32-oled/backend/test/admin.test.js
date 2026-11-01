import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Device } from '../entity/device.js';
import { decrypt } from '../utils/crypto.js';
import { startTestApp } from './support/db.js';

let t;

before(async () => {
  t = await startTestApp();
});

after(async () => {
  await t.stop();
});

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        JSON.parse(line.slice(line.indexOf('=') + 1)),
      ]),
  );
}

describe('admin key', () => {
  it('is required on every admin route', async () => {
    for (const path of ['/api/admin/devices', '/api/admin/devices/oled-aaaaaa/env']) {
      const res = await request(t.app).get(path).expect(401);
      assert.equal(res.body.error.code, 'invalid_admin_key');
    }
  });

  it('rejects a wrong key', async () => {
    await request(t.app).get('/api/admin/devices').set('X-Admin-Key', 'nope').expect(401);
  });
});

describe('POST /api/admin/devices', () => {
  it('creates a hardware device and returns its .env once', async () => {
    const { id, envFile, device } = await t.createDevice();
    assert.match(id, /^oled-[a-z0-9]{6}$/);
    assert.equal(device.secret, undefined);
    assert.equal(device.wifi.password, undefined);
    assert.equal(device.wifi.ssid, 'HomeWiFi');

    const env = parseEnv(envFile);
    assert.equal(env.DEVICE_ID, id);
    assert.equal(env.DEVICE_SECRET.length, 43);
    assert.equal(env.BROKER_URL, t.config.publicMqttUrl);
    assert.equal(env.WIFI_PASS, 'correct horse');

    // Stored encrypted, decryptable with SECRETS_KEY.
    const stored = await Device.findById(id).select('+secret +wifi.password');
    assert.notEqual(stored.secret.data, env.DEVICE_SECRET);
    assert.equal(decrypt(stored.secret, t.config.secretsKey), env.DEVICE_SECRET);
    assert.equal(decrypt(stored.wifi.password, t.config.secretsKey), 'correct horse');
  });

  it('fills in Wokwi Wi-Fi for simulators', async () => {
    const res = await t.admin
      .post('/api/admin/devices')
      .send({ kind: 'simulator', display: 'ssd1306' })
      .expect(201);
    const env = parseEnv(res.body.envFile);
    assert.equal(env.WIFI_SSID, 'Wokwi-GUEST');
    assert.equal(env.WIFI_PASS, '');
  });

  it('validates the body', async () => {
    const cases = [
      [{ kind: 'hardware', display: 'sh1106' }, 'wifi'],
      [{ kind: 'simulator', display: 'sh1106' }, 'display'],
      [
        { kind: 'hardware', display: 'sh1106', wifi: { ssid: 'x', password: 'short' } },
        'wifi.password',
      ],
      [{ kind: 'toaster', display: 'sh1106' }, 'kind'],
      [
        { kind: 'hardware', display: 'sh1106', wifi: { ssid: 'x'.repeat(33), password: '' } },
        'wifi.ssid',
      ],
    ];
    for (const [body, field] of cases) {
      const res = await t.admin.post('/api/admin/devices').send(body).expect(400);
      assert.equal(res.body.error.code, 'invalid_request');
      assert.ok(res.body.error.message.includes(field), `${field}: ${res.body.error.message}`);
    }
  });

  it('accepts an open network (empty password)', async () => {
    const res = await t.admin
      .post('/api/admin/devices')
      .send({ kind: 'hardware', display: 'ssd1306', wifi: { ssid: 'Cafe', password: '' } })
      .expect(201);
    assert.equal(parseEnv(res.body.envFile).WIFI_PASS, '');
  });
});

describe('device management', () => {
  it('lists devices and shows events', async () => {
    const { id } = await t.createDevice();
    const list = await t.admin.get('/api/admin/devices').expect(200);
    assert.ok(list.body.devices.some((d) => d.id === id));
    assert.ok(list.body.devices.every((d) => d.secret === undefined));

    const one = await t.admin.get(`/api/admin/devices/${id}`).expect(200);
    assert.equal(one.body.events[0].type, 'created');
  });

  it('downloads the same .env again', async () => {
    const { id, envFile } = await t.createDevice();
    const res = await t.admin.get(`/api/admin/devices/${id}/env`).expect(200);
    assert.match(res.headers['content-disposition'], new RegExp(`${id}\\.env`));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(parseEnv(res.text), parseEnv(envFile));
  });

  it('changes Wi-Fi', async () => {
    const { id } = await t.createDevice();
    const res = await t.admin
      .patch(`/api/admin/devices/${id}`)
      .send({ wifi: { ssid: 'Office', password: 'new-password' } })
      .expect(200);
    assert.equal(res.body.rebuildRequired, true);
    const env = parseEnv((await t.admin.get(`/api/admin/devices/${id}/env`)).text);
    assert.equal(env.WIFI_SSID, 'Office');
    assert.equal(env.WIFI_PASS, 'new-password');
  });

  it('rotates the secret', async () => {
    const { id, envFile } = await t.createDevice();
    const res = await t.admin.post(`/api/admin/devices/${id}/rotate-secret`).expect(200);
    const before = parseEnv(envFile);
    const after = parseEnv(res.body.envFile);
    assert.notEqual(after.DEVICE_SECRET, before.DEVICE_SECRET);
    assert.equal(after.WIFI_PASS, before.WIFI_PASS);
    assert.equal(res.body.device.secretVersion, 2);
  });

  it('deletes a device', async () => {
    const { id } = await t.createDevice();
    await t.admin.delete(`/api/admin/devices/${id}`).expect(204);
    await t.admin.get(`/api/admin/devices/${id}`).expect(404);
    await t.admin.delete(`/api/admin/devices/${id}`).expect(404);
  });

  it('creates owner pairing codes with a frontend link', async () => {
    const { id } = await t.createDevice();
    const res = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`).expect(201);
    assert.equal(res.body.role, 'owner');
    assert.equal(res.body.url, `${t.config.frontendUrl}/pair/${res.body.code}`);
    const ttl = new Date(res.body.expiresAt) - Date.now();
    assert.ok(ttl > 100_000 && ttl <= 120_000, `ttl ${ttl}`);
  });
});
