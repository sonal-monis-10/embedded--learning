import mongoose from 'mongoose';
import request from 'supertest';
import { createApp, closeDatabase } from '../../app.js';
import { TEST_ADMIN_KEY } from './constants.js';

// Starts the app on an empty database. Test files run one after another
// (--test-concurrency=1) and share one MongoDB, so each file starts clean.
export async function startApp() {
  const app = await createApp();
  await mongoose.connection.dropDatabase();
  await mongoose.syncIndexes();

  const http = request(app);
  const admin = withHeader(http, 'X-Admin-Key', TEST_ADMIN_KEY);
  const asPhone = (token) => withHeader(http, 'Authorization', `Bearer ${token}`);

  // Registers a hardware device.
  async function registerDevice(body = {}) {
    const res = await admin
      .post('/api/admin/devices')
      .send({
        kind: 'hardware',
        display: 'sh1106',
        wifi: { ssid: 'HomeWiFi', password: 'correct horse' },
        ...body,
      })
      .expect(201);
    return { id: res.body.device.id, device: res.body.device, envFile: res.body.envFile };
  }

  // Pairs a phone with a device through a fresh code. Owner codes come from
  // the admin; member codes from `ownerToken`. Pass `token` to scan as a
  // phone that is already paired.
  async function pair(deviceId, { name = 'Phone', role = 'owner', ownerToken, token } = {}) {
    const issuer = role === 'owner' ? admin : asPhone(ownerToken);
    const path =
      role === 'owner'
        ? `/api/admin/devices/${deviceId}/pairing-codes`
        : `/api/devices/${deviceId}/pairing-codes`;
    const { code } = (await issuer.post(path).expect(201)).body;

    const scanner = token ? asPhone(token) : http;
    const res = await scanner.post('/api/pair').send({ code, name }).expect(200);
    return { ...res.body, token: res.body.sessionToken ?? token, code };
  }

  return { app, http, admin, asPhone, registerDevice, pair, stop: closeDatabase };
}

// Parses a device .env file into { KEY: value }.
export function parseEnvFile(text) {
  const entries = text
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), JSON.parse(line.slice(eq + 1))];
    });
  return Object.fromEntries(entries);
}

// supertest with one header set on every request.
function withHeader(http, name, value) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  return Object.fromEntries(methods.map((m) => [m, (path) => http[m](path).set(name, value)]));
}
