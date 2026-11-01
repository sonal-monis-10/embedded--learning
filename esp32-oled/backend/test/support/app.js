import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp, closeDatabase } from '../../app.js';
import { Device } from '../../entity/device.js';
import { attachLiveServer } from '../../live/server.js';
import { offerPairing } from '../../utils/pairingIssuer.js';
import { TEST_ADMIN_KEY, TEST_PROVISION_KEY } from './constants.js';

// Starts the app on an empty database. Test files run one after another
// (--test-concurrency=1) and share one MongoDB, so each file starts clean.
export async function startApp() {
  const app = await createApp();
  await mongoose.connection.dropDatabase();
  await mongoose.syncIndexes();

  const http_ = request(app);
  const admin = withHeader(http_, 'X-Admin-Key', TEST_ADMIN_KEY);
  const firmware = withHeader(http_, 'X-Provision-Key', TEST_PROVISION_KEY);
  const asPhone = (token) => withHeader(http_, 'Authorization', `Bearer ${token}`);

  // Registers a device the way the firmware does on first boot.
  async function provision(body = {}) {
    const res = await firmware
      .post('/api/admin/devices')
      .send({ kind: 'hardware', display: 'sh1106', ...body })
      .expect(201);
    return res.body;
  }

  // Marks a device online (as the broker will report it) and returns the
  // pairing code its OLED would show.
  async function bringOnline(deviceId) {
    await Device.updateOne({ _id: deviceId }, { online: true, lastSeenAt: new Date() });
    return offerPairing(deviceId);
  }

  // A provisioned, online device, ready to pair.
  async function freeDevice() {
    const { deviceId, secret } = await provision();
    const pairing = await bringOnline(deviceId);
    return { deviceId, secret, code: pairing.code };
  }

  // Pairs a phone using the device's current code. Pass `token` to scan as
  // a phone that already has a pass.
  async function pair(code, { name = 'Phone', token } = {}) {
    const scanner = token ? asPhone(token) : http_;
    const res = await scanner.post('/api/pair').send({ code, name }).expect(200);
    return { ...res.body, token: res.body.sessionToken ?? token };
  }

  return {
    app,
    http: http_,
    admin,
    firmware,
    asPhone,
    provision,
    bringOnline,
    freeDevice,
    pair,
    stop: closeDatabase,
  };
}

// A real HTTP server with /api/live attached, for WebSocket tests.
export async function startLive(app) {
  const server = http.createServer(app);
  const stopLive = attachLiveServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/api/live`;
  return {
    url,
    stop: async () => {
      stopLive();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// supertest with one header set on every request.
function withHeader(http_, name, value) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  return Object.fromEntries(methods.map((m) => [m, (path) => http_[m](path).set(name, value)]));
}
