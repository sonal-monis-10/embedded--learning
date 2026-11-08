import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../utils/config.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

describe('GET /healthz', () => {
  it('reports the database as up', async () => {
    const res = await t.http.get('/healthz').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.db, 'up');
    assert.ok('commit' in res.body); // the deploy workflow waits on it
  });

  it('allows the frontend origin', async () => {
    const res = await t.http.get('/healthz').set('Origin', 'http://localhost:5173');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  });
});

describe('errors', () => {
  it('unknown routes use the shared error shape', async () => {
    const res = await t.http.get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'not_found');
  });

  it('malformed JSON is a 400', async () => {
    const res = await t.http
      .post('/api/pair')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    assert.equal(res.body.error.code, 'invalid_json');
  });
});

describe('loadConfig', () => {
  const valid = {
    MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net',
    ADMIN_KEY: 'a'.repeat(24),
    PROVISION_KEY: 'p'.repeat(24),
    SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
    MQTT_ADMIN_PASSWORD: 'm'.repeat(16),
    MQTT_BACKEND_PASSWORD: 'b'.repeat(16),
  };

  it('fills in defaults', () => {
    const config = loadConfig(valid);
    assert.equal(config.port, 8080);
    assert.equal(config.env, 'development');
    assert.equal(config.mongo.dbName, 'oled');
    assert.equal(config.cleanupTimeZone, 'Asia/Kolkata');
    assert.equal(config.secretsKey.length, 32);
    assert.equal(config.maxDevices, 20);
    assert.equal(config.idleReleaseMs, 10 * 60_000);
    assert.equal(config.mqtt.enabled, true);
    assert.equal(config.mqtt.wsPort, 9001);
  });

  it('accepts the frontend as a bare host, as Render passes it', () => {
    const config = loadConfig({ ...valid, CORS_ORIGIN: 'oled-web.onrender.com' });
    assert.equal(config.frontendUrl, 'https://oled-web.onrender.com');
    assert.equal(loadConfig(valid).frontendUrl, 'http://localhost:5173');
  });

  it('works out the public broker address on Render', () => {
    assert.equal(loadConfig(valid).publicMqttUrl, 'ws://localhost:8080/mqtt');
    const onRender = loadConfig({ ...valid, RENDER_EXTERNAL_URL: 'https://oled.onrender.com' });
    assert.equal(onRender.publicMqttUrl, 'wss://oled.onrender.com/mqtt');
    const pinned = {
      ...valid,
      RENDER_EXTERNAL_URL: 'https://a.example',
      PUBLIC_MQTT_URL: 'wss://b.example/mqtt',
    };
    assert.equal(loadConfig(pinned).publicMqttUrl, 'wss://b.example/mqtt');
  });

  it('needs the broker passwords only while MQTT is enabled', () => {
    const { MQTT_ADMIN_PASSWORD, MQTT_BACKEND_PASSWORD, ...withoutBroker } = valid;
    assert.throws(() => loadConfig(withoutBroker), /MQTT_ADMIN_PASSWORD: is required/);
    assert.equal(loadConfig({ ...withoutBroker, MQTT_ENABLED: 'false' }).mqtt.enabled, false);
  });

  it('names every missing variable', () => {
    assert.throws(
      () => loadConfig({}),
      (err) =>
        ['MONGODB_URI', 'PROVISION_KEY', 'ADMIN_KEY', 'SECRETS_KEY'].every((name) =>
          err.message.includes(`${name}: is required`),
        ),
    );
  });

  it('rejects bad values without echoing them', () => {
    const bad = {
      ...valid,
      PORT: 'abc',
      MONGODB_URI: 'http://secret-host',
      ADMIN_KEY: 'short',
      SECRETS_KEY: 'c2hvcnQ=',
      CLEANUP_TZ: 'Mars/Olympus',
    };
    assert.throws(
      () => loadConfig(bad),
      (err) =>
        ['PORT', 'MONGODB_URI', 'ADMIN_KEY', 'SECRETS_KEY', 'CLEANUP_TZ'].every((name) =>
          err.message.includes(name),
        ) && !err.message.includes('secret-host'),
    );
  });
});
