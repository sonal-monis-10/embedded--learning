import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { recordedMessages } from '../mqtt/publisher.js';
import { hashToken } from '../utils/secrets.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

const lastPairingMessage = (deviceId) =>
  recordedMessages().findLast((m) => m.topic === `d/${deviceId}/pairing`);

describe('POST /api/pair', () => {
  it('makes the phone the controller and clears the code from the OLED', async () => {
    const { deviceId, code } = await t.freeDevice();
    const res = await t.pair(code, { name: 'Sonal' });

    assert.equal(res.user.name, 'Sonal');
    assert.equal(res.device.id, deviceId);
    assert.equal(res.device.name, "Sonal's screen");
    assert.ok((await Device.findById(deviceId)).isControlledBy(res.user.id));

    assert.equal(lastPairingMessage(deviceId).payload, null);
    assert.equal(await PairingCode.findLive(deviceId), null);

    const session = await Session.findOne({ tokenHash: hashToken(res.sessionToken) });
    assert.equal(session.expiresAt.toISOString().slice(11), '18:30:00.000Z'); // 00:00 IST
  });

  it('accepts a code typed in lower case with a dash', async () => {
    const { code } = await t.freeDevice();
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    await t.http.post('/api/pair').send({ code: typed, name: 'Typist' }).expect(200);
  });

  it('gives the same error for used, expired and unknown codes', async () => {
    const used = (await t.freeDevice()).code;
    await t.pair(used);
    const expired = (await t.freeDevice()).code;
    await PairingCode.updateOne({ codeHash: hashToken(expired) }, { expiresAt: new Date(0) });

    for (const code of [used, expired, 'ZZZZZZZZ']) {
      const res = await t.http.post('/api/pair').send({ code, name: 'X' }).expect(400);
      assert.equal(res.body.error.code, 'invalid_code');
    }
  });

  it('requires a name', async () => {
    const { code } = await t.freeDevice();
    await t.http.post('/api/pair').send({ code, name: '   ' }).expect(400);
  });

  it('two phones scanning the same QR: only one gets the device', async () => {
    const { code } = await t.freeDevice();
    const results = await Promise.all(
      ['A', 'B'].map((name) => t.http.post('/api/pair').send({ code, name })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it('a stale code for a device someone already took is refused', async () => {
    const { deviceId, code } = await t.freeDevice();
    // A second code for the same device, as if issued just before the first scan.
    const { code: stale } = await PairingCode.issue(deviceId);
    await t.pair(code, { name: 'First' });

    const res = await t.http.post('/api/pair').send({ code: stale, name: 'Late' }).expect(400);
    assert.equal(res.body.error.code, 'invalid_code'); // withdrawn when the device was taken
  });

  it('pairing a second device releases the first, which gets a new code', async () => {
    const first = await t.freeDevice();
    const second = await t.freeDevice();
    const a = await t.pair(first.code, { name: 'Sonal' });
    const b = await t.pair(second.code, { name: 'Sonal', token: a.token });

    assert.equal(b.sessionToken, null);
    assert.equal(b.user.id, a.user.id);
    assert.equal((await Device.findById(first.deviceId)).controller, null);
    assert.ok((await Device.findById(second.deviceId)).isControlledBy(a.user.id));
    assert.ok(lastPairingMessage(first.deviceId).payload.code, 'first device shows a new code');
  });
});

describe('sessions', () => {
  it('/api/me shows the one device this phone controls', async () => {
    const { deviceId, code } = await t.freeDevice();
    const { token } = await t.pair(code);
    const me = await t.asPhone(token).get('/api/me').expect(200);
    assert.equal(me.body.device.id, deviceId);
  });

  it('/api/me needs a valid, unexpired token', async () => {
    await t.http.get('/api/me').expect(401);
    const { code } = await t.freeDevice();
    const { token } = await t.pair(code);
    await Session.updateOne({ tokenHash: hashToken(token) }, { expiresAt: new Date(0) });
    const res = await t.asPhone(token).get('/api/me').expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it('logout ends the session and frees the device', async () => {
    const { deviceId, code } = await t.freeDevice();
    const { token, user } = await t.pair(code);
    await t.asPhone(token).post('/api/logout').expect(204);

    await t.asPhone(token).get('/api/me').expect(401);
    assert.equal((await Device.findById(deviceId)).controller, null);
    assert.ok(await User.findById(user.id), 'the user stays until the nightly cleanup');
  });
});
