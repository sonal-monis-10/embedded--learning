import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { recordedMessages } from '../mqtt/publisher.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

// A device and the phone controlling it.
async function playing(name = 'Sonal') {
  const { deviceId, code } = await t.freeDevice();
  const { token } = await t.pair(code, { name });
  return { deviceId, phone: t.asPhone(token) };
}

describe('access', () => {
  it('needs a session', async () => {
    const res = await t.http.get('/api/devices/oled-aaaaaa').expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it("another phone can't see or touch the device (404)", async () => {
    const { deviceId } = await playing('Owner');
    const stranger = (await playing('Stranger')).phone;

    for (const res of await Promise.all([
      stranger.get(`/api/devices/${deviceId}`),
      stranger.put(`/api/devices/${deviceId}/mode`).send({ mode: 'eyes' }),
      stranger.post(`/api/devices/${deviceId}/leave`),
    ])) {
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'device_not_found');
    }
  });
});

describe('controlling the device', () => {
  it('shows and renames it', async () => {
    const { deviceId, phone } = await playing();
    const res = await phone.get(`/api/devices/${deviceId}`).expect(200);
    assert.equal(res.body.device.name, "Sonal's screen");
    const renamed = await phone
      .patch(`/api/devices/${deviceId}`)
      .send({ name: 'Desk' })
      .expect(200);
    assert.equal(renamed.body.device.name, 'Desk');
  });

  it('sets the mode and publishes it to the device', async () => {
    const { deviceId, phone } = await playing();
    await phone.put(`/api/devices/${deviceId}/mode`).send({ mode: 'eyes' }).expect(200);

    assert.equal((await Device.findById(deviceId)).mode, 'eyes');
    const message = recordedMessages().findLast((m) => m.topic === `d/${deviceId}/mode`);
    assert.deepEqual(message, {
      topic: `d/${deviceId}/mode`,
      payload: { mode: 'eyes' },
      retain: true,
      qos: 1,
    });
  });

  it('rejects unknown modes and commands', async () => {
    const { deviceId, phone } = await playing();
    await phone.put(`/api/devices/${deviceId}/mode`).send({ mode: 'disco' }).expect(400);
    await phone.post(`/api/devices/${deviceId}/commands`).send({ op: 'explode' }).expect(400);
    await phone
      .post(`/api/devices/${deviceId}/commands`)
      .send({ op: 'brightness', value: 999 })
      .expect(400);
  });

  it('sends commands to the device', async () => {
    const { deviceId, phone } = await playing();
    await phone.post(`/api/devices/${deviceId}/commands`).send({ op: 'identify' }).expect(202);
    const message = recordedMessages().findLast((m) => m.topic === `d/${deviceId}/cmd`);
    assert.deepEqual(message.payload, { op: 'identify' });
  });

  it('leave frees the device and puts a new code on its OLED', async () => {
    const { deviceId, phone } = await playing();
    await phone.post(`/api/devices/${deviceId}/leave`).expect(204);

    assert.equal((await Device.findById(deviceId)).controller, null);
    await phone.get(`/api/devices/${deviceId}`).expect(404);
    const pairing = recordedMessages().findLast((m) => m.topic === `d/${deviceId}/pairing`);
    assert.ok(pairing.payload.code);
  });
});
