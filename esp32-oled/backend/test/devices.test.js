import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp } from './support/db.js';

let t;

before(async () => {
  t = await startTestApp();
});

after(async () => {
  await t.stop();
});

const as = (token) => ({
  get: (path) => request(t.app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path) => request(t.app).post(path).set('Authorization', `Bearer ${token}`),
  put: (path) => request(t.app).put(path).set('Authorization', `Bearer ${token}`),
  patch: (path) => request(t.app).patch(path).set('Authorization', `Bearer ${token}`),
  delete: (path) => request(t.app).delete(path).set('Authorization', `Bearer ${token}`),
});

// A device with an owner and one member.
async function household() {
  const { id } = await t.createDevice();
  const owner = await t.pair(id, { name: 'Owner' });
  const member = await t.pair(id, { name: 'Member', role: 'member', ownerToken: owner.token });
  return { id, owner, member };
}

describe('access', () => {
  it('needs a session', async () => {
    const res = await request(t.app).get('/api/devices').expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it("a stranger can't see or touch a device (404, not 403)", async () => {
    const { id } = await household();
    const other = await t.createDevice();
    const stranger = await t.pair(other.id, { name: 'Stranger' });

    for (const res of [
      await as(stranger.token).get(`/api/devices/${id}`),
      await as(stranger.token).put(`/api/devices/${id}/mode`).send({ mode: 'eyes' }),
      await as(stranger.token).post(`/api/devices/${id}/pairing-codes`),
    ]) {
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'device_not_found');
    }
    const list = await as(stranger.token).get('/api/devices').expect(200);
    assert.deepEqual(
      list.body.devices.map((d) => d.id),
      [other.id],
    );
  });
});

describe('members', () => {
  it('owner code → owner, member code → member', async () => {
    const { id, owner, member } = await household();
    assert.equal(owner.device.role, 'owner');
    assert.equal(member.device.role, 'member');

    const detail = await as(member.token).get(`/api/devices/${id}`).expect(200);
    assert.deepEqual(
      detail.body.members.map((m) => [m.name, m.role]),
      [
        ['Owner', 'owner'],
        ['Member', 'member'],
      ],
    );
    assert.equal(detail.body.device.memberCount, 2);
    assert.equal(detail.body.device.wifi, undefined);
  });

  it('only the owner can create member codes and rename', async () => {
    const { id, member } = await household();
    const code = await as(member.token).post(`/api/devices/${id}/pairing-codes`).expect(403);
    assert.equal(code.body.error.code, 'owner_only');
    await as(member.token).patch(`/api/devices/${id}`).send({ name: 'Mine' }).expect(403);
  });

  it('owner renames the device', async () => {
    const { id, owner } = await household();
    const res = await as(owner.token)
      .patch(`/api/devices/${id}`)
      .send({ name: 'Desk' })
      .expect(200);
    assert.equal(res.body.device.name, 'Desk');
  });

  it('a member scanning a member code again stays a member', async () => {
    const { id, owner, member } = await household();
    const again = await t.pair(id, {
      token: member.token,
      role: 'member',
      ownerToken: owner.token,
    });
    assert.equal(again.device.role, 'member');
    assert.equal(again.device.memberCount, 2);
  });

  it('owner removes a member; a member can only remove themselves', async () => {
    const { id, owner, member } = await household();
    const ownerId = owner.user.id;
    const memberId = member.user.id;

    await as(member.token).delete(`/api/devices/${id}/members/${ownerId}`).expect(403);
    await as(owner.token).delete(`/api/devices/${id}/members/${memberId}`).expect(204);
    await as(member.token).get(`/api/devices/${id}`).expect(404);
    await as(owner.token).delete(`/api/devices/${id}/members/${memberId}`).expect(404);
    await as(owner.token).delete(`/api/devices/${id}/members/not-an-id`).expect(404);
  });

  it('a member can leave', async () => {
    const { id, member } = await household();
    await as(member.token).delete(`/api/devices/${id}/members/${member.user.id}`).expect(204);
    const list = await as(member.token).get('/api/devices').expect(200);
    assert.equal(list.body.devices.length, 0);
  });
});

describe('PUT /api/devices/:id/mode', () => {
  it('any member can change the mode', async () => {
    const { id, member } = await household();
    const res = await as(member.token)
      .put(`/api/devices/${id}/mode`)
      .send({ mode: 'eyes' })
      .expect(200);
    assert.equal(res.body.mode, 'eyes');
    const detail = await as(member.token).get(`/api/devices/${id}`);
    assert.equal(detail.body.device.mode, 'eyes');
  });

  it('rejects unknown modes', async () => {
    const { id, owner } = await household();
    await as(owner.token).put(`/api/devices/${id}/mode`).send({ mode: 'disco' }).expect(400);
  });
});
