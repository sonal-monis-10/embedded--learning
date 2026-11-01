import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp, closeDatabase } from '../../app.js';
import { loadConfig } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';

export const TEST_ADMIN_KEY = 'test-admin-key-0123456789abcdef';

export function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    ADMIN_KEY: TEST_ADMIN_KEY,
    SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
    ...overrides,
  };
}

// Starts a throwaway MongoDB for one test file (the first run downloads a
// mongod binary into ~/.cache). Tests never touch the real Atlas database.
export async function startTestDb() {
  const mongod = await MongoMemoryServer.create();
  const config = loadConfig(testEnv({ MONGODB_URI: mongod.getUri(), MONGODB_DB: 'oled-test' }));
  return { mongod, config, logger: createLogger({ level: 'silent' }) };
}

// The full app on a throwaway database, plus helpers used by most tests.
export async function startTestApp() {
  const { mongod, config, logger } = await startTestDb();
  const app = await createApp({ config, logger });

  const admin = {
    get: (path) => request(app).get(path).set('X-Admin-Key', TEST_ADMIN_KEY),
    post: (path) => request(app).post(path).set('X-Admin-Key', TEST_ADMIN_KEY),
    patch: (path) => request(app).patch(path).set('X-Admin-Key', TEST_ADMIN_KEY),
    delete: (path) => request(app).delete(path).set('X-Admin-Key', TEST_ADMIN_KEY),
  };

  // Registers a hardware device and returns its id and .env text.
  async function createDevice(body = {}) {
    const res = await admin
      .post('/api/admin/devices')
      .send({
        kind: 'hardware',
        display: 'sh1106',
        wifi: { ssid: 'HomeWiFi', password: 'correct horse' },
        ...body,
      })
      .expect(201);
    return { id: res.body.device.id, envFile: res.body.envFile, device: res.body.device };
  }

  // Pairs a phone with a device through a fresh code. Pass `token` to pair as
  // an existing session, `role: 'member'` + `ownerToken` for a member code.
  async function pair(deviceId, { name = 'Phone', token, role = 'owner', ownerToken } = {}) {
    const codeRes =
      role === 'owner'
        ? await admin.post(`/api/admin/devices/${deviceId}/pairing-codes`).expect(201)
        : await request(app)
            .post(`/api/devices/${deviceId}/pairing-codes`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .expect(201);
    const req = request(app).post('/api/pair').send({ code: codeRes.body.code, name });
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    return { ...res.body, token: res.body.sessionToken ?? token, code: codeRes.body.code };
  }

  async function stop() {
    await closeDatabase();
    await mongod.stop();
  }

  return { app, config, logger, admin, createDevice, pair, stop };
}
