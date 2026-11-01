import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { hashToken } from '../utils/secrets.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

async function ownerCode(deviceId) {
  const res = await t.admin.post(`/api/admin/devices/${deviceId}/pairing-codes`).expect(201);
  return res.body.code;
}

describe('POST /api/pair', () => {
  it('makes the scanner the owner and starts a session until midnight IST', async () => {
    const { id } = await t.registerDevice();
    const res = await t.pair(id, { name: 'Sonal' });

    assert.equal(res.user.name, 'Sonal');
    assert.equal(res.device.role, 'owner');
    assert.equal(res.device.name, "Sonal's OLED");

    const session = await Session.findOne({ tokenHash: hashToken(res.sessionToken) });
    assert.equal(session.expiresAt.toISOString(), res.expiresAt);
    // 00:00 IST is 18:30 UTC.
    assert.equal(session.expiresAt.toISOString().slice(11), '18:30:00.000Z');
  });

  it('accepts a code typed in lower case with a dash', async () => {
    const { id } = await t.registerDevice();
    const code = await ownerCode(id);
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    await t.http.post('/api/pair').send({ code: typed, name: 'Typist' }).expect(200);
  });

  it('gives the same error for used, expired and unknown codes', async () => {
    const { id } = await t.registerDevice();
    const { code: used } = await t.pair(id);
    const expired = await ownerCode(id);
    await PairingCode.updateOne({ codeHash: hashToken(expired) }, { expiresAt: new Date(0) });

    for (const code of [used, expired, 'ZZZZZZZZ']) {
      const res = await t.http.post('/api/pair').send({ code, name: 'X' }).expect(400);
      assert.equal(res.body.error.code, 'invalid_code');
    }
  });

  it('requires a name', async () => {
    const { id } = await t.registerDevice();
    const code = await ownerCode(id);
    await t.http.post('/api/pair').send({ code, name: '   ' }).expect(400);
  });

  it('lets only one of two phones redeem the same code', async () => {
    const { id } = await t.registerDevice();
    const code = await ownerCode(id);
    const results = await Promise.all(
      ['A', 'B'].map((name) => t.http.post('/api/pair').send({ code, name })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it('keeps the same user when a paired phone scans another device', async () => {
    const first = await t.registerDevice();
    const second = await t.registerDevice();
    const a = await t.pair(first.id, { name: 'Sonal' });
    const b = await t.pair(second.id, { name: 'Sonal', token: a.token });

    assert.equal(b.sessionToken, null);
    assert.equal(b.user.id, a.user.id);
    const me = await t.asPhone(a.token).get('/api/me').expect(200);
    assert.equal(me.body.devices.length, 2);
  });

  it('a new owner code replaces a lost owner phone', async () => {
    const { id } = await t.registerDevice();
    const lost = await t.pair(id, { name: 'Old phone' });
    const replacement = await t.pair(id, { name: 'New phone' });

    await t.asPhone(lost.token).get(`/api/devices/${id}`).expect(404);
    const res = await t.asPhone(replacement.token).get(`/api/devices/${id}`).expect(200);
    assert.deepEqual(
      res.body.members.map((m) => [m.name, m.role]),
      [['New phone', 'owner']],
    );
  });
});

describe('sessions', () => {
  it('/api/me needs a valid token', async () => {
    await t.http.get('/api/me').expect(401);
    const res = await t.asPhone('made-up').get('/api/me').expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it('an expired session is refused before the cleanup deletes it', async () => {
    const { id } = await t.registerDevice();
    const { token } = await t.pair(id);
    await Session.updateOne({ tokenHash: hashToken(token) }, { expiresAt: new Date(0) });
    await t.asPhone(token).get('/api/me').expect(401);
  });

  it('renames the user', async () => {
    const { id } = await t.registerDevice();
    const { token } = await t.pair(id, { name: 'Before' });
    const res = await t.asPhone(token).patch('/api/me').send({ name: 'After' }).expect(200);
    assert.equal(res.body.user.name, 'After');
  });

  it('logout ends the session; the user stays until the cleanup', async () => {
    const { id } = await t.registerDevice();
    const { token, user } = await t.pair(id);
    await t.asPhone(token).post('/api/logout').expect(204);
    await t.asPhone(token).get('/api/me').expect(401);
    assert.ok(await User.findById(user.id));
  });
});
