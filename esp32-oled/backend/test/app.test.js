import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, closeDatabase } from '../app.js';
import { loadConfig } from '../utils/config.js';
import { startTestDb } from './support/db.js';

let app;
let mongod;

before(async () => {
  const db = await startTestDb();
  mongod = db.mongod;
  app = await createApp({ config: db.config, logger: db.logger });
});

after(async () => {
  await closeDatabase();
  await mongod.stop();
});

describe('GET /healthz', () => {
  it('returns ok with the database up', async () => {
    const res = await request(app).get('/healthz').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.db, 'up');
    assert.equal(typeof res.body.uptimeSeconds, 'number');
  });

  it('allows the configured frontend origin', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'http://localhost:5173');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  });
});

describe('errors', () => {
  it('unknown routes return the shared error shape', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'not_found');
  });

  it('malformed JSON returns 400 invalid_json', async () => {
    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    assert.equal(res.body.error.code, 'invalid_json');
  });
});

describe('loadConfig', () => {
  const uri = 'mongodb+srv://u:p@cluster.example.net';

  it('applies defaults', () => {
    const c = loadConfig({ MONGODB_URI: uri });
    assert.equal(c.port, 8080);
    assert.equal(c.env, 'development');
    assert.equal(c.mongo.dbName, 'oled');
  });

  it('requires MONGODB_URI', () => {
    assert.throws(() => loadConfig({}), /MONGODB_URI: is required/);
  });

  it('lists every invalid variable without echoing the connection string', () => {
    assert.throws(
      () => loadConfig({ PORT: 'abc', CORS_ORIGIN: 'not a url', MONGODB_URI: 'http://secret' }),
      (err) =>
        ['PORT', 'CORS_ORIGIN', 'MONGODB_URI'].every((name) => err.message.includes(name)) &&
        !err.message.includes('http://secret'),
    );
  });
});
