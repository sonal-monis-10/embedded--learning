import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { recordedMessages } from '../mqtt/publisher.js';
import { startApp, startServer } from './support/app.js';

let t;
let live;
before(async () => {
  t = await startApp();
  live = await startServer(t.app);
});
after(async () => {
  await live.stop();
  await t.stop();
});

// Opens /api/live and collects what the server sends.
async function connect() {
  const ws = new WebSocket(live.liveUrl);
  const received = [];
  ws.on('message', (data) => received.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  const closed = new Promise((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  return { ws, received, closed, send: (m) => ws.send(JSON.stringify(m)) };
}

const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function playing() {
  const { deviceId, code } = await t.freeDevice();
  const { token } = await t.pair(code);
  return { deviceId, token };
}

const imuFor = (deviceId) => recordedMessages().filter((m) => m.topic === `d/${deviceId}/imu`);

describe('/api/live', () => {
  it('sends status after auth and forwards tilt readings to the device', async () => {
    const { deviceId, token } = await playing();
    const phone = await connect();
    phone.send({ t: 'auth', token });
    await until(() => phone.received.length > 0);
    assert.deepEqual(phone.received[0], { t: 'status', online: true, mode: 'idle' });

    phone.send({ t: 'imu', v: [-12.5, 4, 1.02, 1] });
    await until(() => imuFor(deviceId).length === 1);
    assert.deepEqual(imuFor(deviceId)[0].payload, [-12.5, 4, 1.02, 1]);
    phone.ws.close();
  });

  it('closes when the first message is not a valid auth', async () => {
    const phone = await connect();
    phone.send({ t: 'auth', token: 'made-up' });
    assert.equal((await phone.closed).code, 4401);
  });

  it('closes when the session controls no device', async () => {
    const { deviceId, token } = await playing();
    await t.asPhone(token).post(`/api/devices/${deviceId}/leave`).expect(204);
    const phone = await connect();
    phone.send({ t: 'auth', token });
    assert.equal((await phone.closed).code, 4404);
  });

  it('drops malformed and out-of-range readings', async () => {
    const { deviceId, token } = await playing();
    const phone = await connect();
    phone.send({ t: 'auth', token });
    await until(() => phone.received.length > 0);

    phone.send({ t: 'imu', v: [999, 0, 1, 1] });
    phone.send({ t: 'imu', v: ['x', 0, 1, 2] });
    phone.send({ t: 'imu', v: [1, 2, 1, 3] });
    await until(() => imuFor(deviceId).length === 1);
    assert.deepEqual(imuFor(deviceId)[0].payload, [1, 2, 1, 3]);
    phone.ws.close();
  });

  it('caps readings at 30 a second', async () => {
    const { deviceId, token } = await playing();
    const phone = await connect();
    phone.send({ t: 'auth', token });
    await until(() => phone.received.length > 0);

    for (let seq = 0; seq < 50; seq++) phone.send({ t: 'imu', v: [0, 0, 1, seq] });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(imuFor(deviceId).length, 30);
    phone.ws.close();
  });

  it('tells the phone when its turn ends, then closes', async () => {
    const { deviceId, token } = await playing();
    const phone = await connect();
    phone.send({ t: 'auth', token });
    await until(() => phone.received.length > 0);

    await t.admin.post(`/api/admin/devices/${deviceId}/release`).expect(200);
    const { code } = await phone.closed;
    assert.equal(code, 4000);
    assert.deepEqual(phone.received.at(-1), { t: 'released', reason: 'admin' });
  });
});
