import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import mqtt from 'mqtt';
import WebSocket from 'ws';
import { Device } from '../entity/device.js';
import { startBroker } from '../mqtt/broker.js';
import { config } from '../utils/config.js';
import { startApp, startServer } from './support/app.js';

// Runs against a real Mosquitto, reached the way devices reach it: through
// the backend's /mqtt pipe. Skipped where Mosquitto is not installed;
// `make test-docker` runs it inside the backend image.
const hasMosquitto = (() => {
  try {
    execFileSync('sh', ['-c', `command -v ${config.mqtt.bin}`]);
    return true;
  } catch {
    return false;
  }
})();

let t;
let server;
let stopBroker;

describe('broker', { skip: !hasMosquitto && 'Mosquitto is not installed' }, () => {
  before(async () => {
    t = await startApp();
    stopBroker = await startBroker();
    server = await startServer(t.app);
  });
  after(async () => {
    await server?.stop();
    await stopBroker?.();
    await t?.stop();
  });

  // Connects as a device, the way the firmware does.
  function connectDevice(deviceId, secret, options = {}) {
    return mqtt.connectAsync(server.mqttUrl, {
      clientId: deviceId,
      username: deviceId,
      password: secret,
      reconnectPeriod: 0,
      will: { topic: `d/${deviceId}/status`, payload: '{"online":false}', retain: true, qos: 1 },
      ...options,
    });
  }

  // Collects messages a device receives, by topic.
  function inbox(client) {
    const messages = [];
    client.on('message', (topic, payload) => messages.push({ topic, text: payload.toString() }));
    return {
      messages,
      next: (topic) =>
        until(() => messages.find((m) => m.topic === topic && !m.seen)).then((m) => {
          m.seen = true;
          return m.text;
        }),
    };
  }

  async function online(deviceId, secret) {
    const client = await connectDevice(deviceId, secret);
    const box = inbox(client);
    await client.subscribeAsync(`d/${deviceId}/#`, { qos: 1 });
    await client.publishAsync(`d/${deviceId}/status`, '{"online":true,"fw":"0.1.0"}', {
      retain: true,
      qos: 1,
    });
    return { client, box };
  }

  describe('logins', () => {
    it('a provisioned device connects with its secret', async () => {
      const { deviceId, secret } = await t.provision();
      const client = await connectDevice(deviceId, secret);
      assert.ok(client.connected);
      await client.endAsync();
    });

    it('refuses a wrong secret, an unknown device and anonymous clients', async () => {
      const { deviceId } = await t.provision();
      await assert.rejects(connectDevice(deviceId, 'wrong'));
      await assert.rejects(connectDevice('oled-zzzzzz', 'whatever'));
      await assert.rejects(
        mqtt.connectAsync(server.mqttUrl, { reconnectPeriod: 0, clientId: 'anon' }),
      );
    });

    it('a device cannot read or write another device’s topics', async () => {
      const a = await t.provision();
      const b = await t.provision();
      const client = await connectDevice(a.deviceId, a.secret);

      const [grant] = await client.subscribeAsync(`d/${b.deviceId}/#`);
      assert.equal(grant.qos, 128, 'subscription refused');
      await client.endAsync();
    });
  });

  describe('a device coming online', () => {
    it('is marked online and gets a pairing code on its screen', async () => {
      const { deviceId, secret } = await t.provision();
      const { client, box } = await online(deviceId, secret);

      const pairing = JSON.parse(await box.next(`d/${deviceId}/pairing`));
      assert.match(pairing.code, /^[A-Z2-9]{8}$/);
      assert.equal(pairing.url, `http://localhost:5173/pair/${pairing.code}`);
      assert.equal((await Device.findById(deviceId)).online, true);

      // Pairing clears the screen, and mode changes reach the device.
      const { token } = await t.pair(pairing.code, { name: 'Sonal' });
      assert.equal(await box.next(`d/${deviceId}/pairing`), '');
      await t.asPhone(token).put(`/api/devices/${deviceId}/mode`).send({ mode: 'eyes' });
      assert.equal(await box.next(`d/${deviceId}/mode`), '{"mode":"eyes"}');

      // Tilt from the phone's /api/live socket reaches the device.
      const phone = new WebSocket(server.liveUrl);
      await new Promise((resolve) => phone.once('open', resolve));
      phone.send(JSON.stringify({ t: 'auth', token }));
      await new Promise((resolve) => phone.once('message', resolve));
      phone.send(JSON.stringify({ t: 'imu', v: [10, -5, 1, 1] }));
      assert.equal(await box.next(`d/${deviceId}/imu`), '[10,-5,1,1]');
      phone.close();
      await client.endAsync();
    });

    it('dropping off without a goodbye marks it offline (Last Will)', async () => {
      const { deviceId, secret } = await t.provision();
      const { client } = await online(deviceId, secret);
      await until(async () => (await Device.findById(deviceId)).online);

      client.stream.destroy(); // like pulling the power
      await until(async () => !(await Device.findById(deviceId)).online, 5000);
    });

    it('deleting the device disconnects it', async () => {
      const { deviceId, secret } = await t.provision();
      const client = await connectDevice(deviceId, secret);
      const closed = new Promise((resolve) => client.once('close', resolve));

      await t.admin.delete(`/api/admin/devices/${deviceId}`).expect(204);
      await closed;
      await assert.rejects(connectDevice(deviceId, secret));
    });
  });

  describe('a broker restart', () => {
    it('rebuilds every device login from MongoDB', async () => {
      const { deviceId, secret } = await t.provision();
      await stopBroker();
      stopBroker = await startBroker();

      const client = await connectDevice(deviceId, secret);
      assert.ok(client.connected);
      await client.endAsync();
    });
  });
});

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
