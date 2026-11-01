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
    SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
  };

  it('fills in defaults', () => {
    const config = loadConfig(valid);
    assert.equal(config.port, 8080);
    assert.equal(config.env, 'development');
    assert.equal(config.mongo.dbName, 'oled');
    assert.equal(config.cleanupTimeZone, 'Asia/Kolkata');
    assert.equal(config.secretsKey.length, 32);
  });

  it('names every missing variable', () => {
    assert.throws(
      () => loadConfig({}),
      (err) =>
        ['MONGODB_URI', 'ADMIN_KEY', 'SECRETS_KEY'].every((name) =>
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
