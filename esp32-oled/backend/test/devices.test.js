import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

// A device with two paired phones. Each phone has `api` (requests sent with
// its session) and `userId`.
async function sharedDevice() {
  const { id } = await t.registerDevice();
  const owner = await t.pair(id, { name: 'Owner' });
  const member = await t.pair(id, { name: 'Member', role: 'member', ownerToken: owner.token });
  const phone = (paired) => ({ api: t.asPhone(paired.token), userId: paired.user.id });
  return { id, owner: phone(owner), member: phone(member) };
}

describe('access', () => {
  it('needs a session', async () => {
    const res = await t.http.get('/api/devices').expect(401);
    assert.equal(res.body.error.code, 'session_required');
  });

  it("hides other people's devices (404, not 403)", async () => {
    const { id } = await sharedDevice();
    const other = await t.registerDevice();
    const stranger = t.asPhone((await t.pair(other.id, { name: 'Stranger' })).token);

    const attempts = await Promise.all([
      stranger.get(`/api/devices/${id}`),
      stranger.put(`/api/devices/${id}/mode`).send({ mode: 'eyes' }),
      stranger.post(`/api/devices/${id}/pairing-codes`),
    ]);
    for (const res of attempts) {
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'device_not_found');
    }

    const list = await stranger.get('/api/devices').expect(200);
    assert.deepEqual(
      list.body.devices.map((d) => d.id),
      [other.id],
    );
  });
});

describe('members', () => {
  it('owner codes make owners, member codes make members', async () => {
    const { id, member } = await sharedDevice();
    const res = await member.api.get(`/api/devices/${id}`).expect(200);

    assert.deepEqual(
      res.body.members.map((m) => [m.name, m.role]),
      [
        ['Owner', 'owner'],
        ['Member', 'member'],
      ],
    );
    assert.equal(res.body.device.role, 'member');
    assert.equal(res.body.device.wifi, undefined);
  });

  it('only the owner can add phones and rename the device', async () => {
    const { id, owner, member } = await sharedDevice();

    const denied = await member.api.post(`/api/devices/${id}/pairing-codes`).expect(403);
    assert.equal(denied.body.error.code, 'owner_only');
    await member.api.patch(`/api/devices/${id}`).send({ name: 'Mine' }).expect(403);

    const res = await owner.api.patch(`/api/devices/${id}`).send({ name: 'Desk' }).expect(200);
    assert.equal(res.body.device.name, 'Desk');
  });

  it('the owner can remove members; a member cannot remove the owner', async () => {
    const { id, owner, member } = await sharedDevice();

    await member.api.delete(`/api/devices/${id}/members/${owner.userId}`).expect(403);
    await owner.api.delete(`/api/devices/${id}/members/${member.userId}`).expect(204);
    await member.api.get(`/api/devices/${id}`).expect(404);

    await owner.api.delete(`/api/devices/${id}/members/${member.userId}`).expect(404);
    await owner.api.delete(`/api/devices/${id}/members/not-an-id`).expect(404);
  });

  it('a member can leave', async () => {
    const { id, member } = await sharedDevice();
    await member.api.delete(`/api/devices/${id}/members/${member.userId}`).expect(204);
    const res = await member.api.get('/api/devices').expect(200);
    assert.equal(res.body.devices.length, 0);
  });
});

describe('mode', () => {
  it('any member can set it', async () => {
    const { id, member } = await sharedDevice();
    await member.api.put(`/api/devices/${id}/mode`).send({ mode: 'eyes' }).expect(200);
    const res = await member.api.get(`/api/devices/${id}`);
    assert.equal(res.body.device.mode, 'eyes');
  });

  it('rejects unknown modes', async () => {
    const { id, owner } = await sharedDevice();
    await owner.api.put(`/api/devices/${id}/mode`).send({ mode: 'disco' }).expect(400);
  });
});
