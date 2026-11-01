import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { sha256 } from '../utils/crypto.js';
import { startTestApp } from './support/db.js';

let t;

before(async () => {
  t = await startTestApp();
});

after(async () => {
  await t.stop();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('POST /api/pair', () => {
  it('turns an owner code into a user, a session and ownership', async () => {
    const { id } = await t.createDevice();
    const res = await t.pair(id, { name: 'Sonal' });

    assert.equal(res.sessionToken.length, 43);
    assert.equal(res.user.name, 'Sonal');
    assert.equal(res.device.id, id);
    assert.equal(res.device.role, 'owner');
    assert.equal(res.device.name, "Sonal's OLED");

    // Session expires at the next 00:00 IST and is stored only as a hash.
    const session = await Session.findOne({ tokenHash: sha256(res.sessionToken) });
    assert.ok(session);
    assert.equal(new Date(res.expiresAt).toISOString(), session.expiresAt.toISOString());
    assert.equal(session.expiresAt.getUTCHours(), 18);
    assert.equal(session.expiresAt.getUTCMinutes(), 30);
  });

  it('accepts a code typed in lower case with a dash', async () => {
    const { id } = await t.createDevice();
    const { body } = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
    const typed = `${body.code.slice(0, 4)}-${body.code.slice(4)}`.toLowerCase();
    await request(t.app).post('/api/pair').send({ code: typed, name: 'Typist' }).expect(200);
  });

  it('works only once', async () => {
    const { id } = await t.createDevice();
    const { code } = await t.pair(id);
    const res = await request(t.app).post('/api/pair').send({ code, name: 'Second' }).expect(400);
    assert.equal(res.body.error.code, 'invalid_code');
  });

  it('rejects expired and unknown codes with the same error', async () => {
    const { id } = await t.createDevice();
    const { body } = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
    await PairingCode.updateOne(
      { codeHash: sha256(body.code) },
      { expiresAt: new Date(Date.now() - 1) },
    );

    for (const code of [body.code, 'ZZZZZZZZ']) {
      const res = await request(t.app).post('/api/pair').send({ code, name: 'X' }).expect(400);
      assert.equal(res.body.error.code, 'invalid_code');
    }
  });

  it('requires a name', async () => {
    const { id } = await t.createDevice();
    const { body } = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
    const res = await request(t.app)
      .post('/api/pair')
      .send({ code: body.code, name: '  ' })
      .expect(400);
    assert.equal(res.body.error.code, 'invalid_request');
  });

  it('only one of two phones can redeem the same code', async () => {
    const { id } = await t.createDevice();
    const { body } = await t.admin.post(`/api/admin/devices/${id}/pairing-codes`);
    const results = await Promise.all(
      ['A', 'B'].map((name) => request(t.app).post('/api/pair').send({ code: body.code, name })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it('reuses the user when an already-paired phone scans another device', async () => {
    const first = await t.createDevice();
    const second = await t.createDevice();
    const a = await t.pair(first.id, { name: 'Sonal' });
    const b = await t.pair(second.id, { name: 'Sonal', token: a.token });

    assert.equal(b.sessionToken, null);
    assert.equal(b.user.id, a.user.id);

    const me = await request(t.app).get('/api/me').set(bearer(a.token)).expect(200);
    assert.deepEqual(me.body.devices.map((d) => d.id).sort(), [first.id, second.id].sort());
  });

  it('an owner code replaces a lost owner phone', async () => {
    const { id } = await t.createDevice();
    const lost = await t.pair(id, { name: 'Old phone' });
    const fresh = await t.pair(id, { name: 'New phone' });
    assert.equal(fresh.device.role, 'owner');

    await request(t.app).get(`/api/devices/${id}`).set(bearer(lost.token)).expect(404);
    const detail = await request(t.app)
      .get(`/api/devices/${id}`)
      .set(bearer(fresh.token))
      .expect(200);
    assert.deepEqual(
      detail.body.members.map((m) => [m.name, m.role]),
      [['New phone', 'owner']],
    );
  });
});

describe('sessions', () => {
  it('/api/me needs a valid token', async () => {
    await request(t.app).get('/api/me').expect(401);
    const res = await request(t.app).get('/api/me').set(bearer('made-up')).expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it('an expired session is rejected even before cleanup deletes it', async () => {
    const { id } = await t.createDevice();
    const { token } = await t.pair(id);
    await Session.updateOne({ tokenHash: sha256(token) }, { expiresAt: new Date(Date.now() - 1) });
    await request(t.app).get('/api/me').set(bearer(token)).expect(401);
  });

  it('renames the user', async () => {
    const { id } = await t.createDevice();
    const { token } = await t.pair(id, { name: 'Before' });
    const res = await request(t.app)
      .patch('/api/me')
      .set(bearer(token))
      .send({ name: 'After' })
      .expect(200);
    assert.equal(res.body.user.name, 'After');
  });

  it('logout ends the session and keeps the user until cleanup', async () => {
    const { id } = await t.createDevice();
    const { token, user } = await t.pair(id);
    await request(t.app).post('/api/logout').set(bearer(token)).expect(204);
    await request(t.app).get('/api/me').set(bearer(token)).expect(401);
    assert.ok(await User.findById(user.id));
  });
});
