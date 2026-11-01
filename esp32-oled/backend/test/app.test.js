import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';

const config = loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' });
const app = createApp({ config, logger: createLogger({ level: 'silent' }) });

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/healthz').expect(200);
    assert.equal(res.body.status, 'ok');
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
  it('applies defaults', () => {
    const c = loadConfig({});
    assert.equal(c.port, 8080);
    assert.equal(c.env, 'development');
  });

  it('lists every invalid variable', () => {
    assert.throws(
      () => loadConfig({ PORT: 'abc', CORS_ORIGIN: 'not a url' }),
      (err) => err.message.includes('PORT') && err.message.includes('CORS_ORIGIN'),
    );
  });
});
