import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Device, NIGHTLY_RESET } from '../entity/device.js';
import { User } from '../entity/user.js';
import { startTestDb } from './support/db.js';

let mongod;

before(async () => {
  const db = await startTestDb();
  mongod = db.mongod;
  await mongoose.connect(db.config.mongo.uri, { dbName: db.config.mongo.dbName });
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const encrypted = { iv: 'aXY=', tag: 'dGFn', data: 'ZGF0YQ==' };

function newDevice(overrides = {}) {
  return {
    _id: 'oled-7k2m9q',
    kind: 'hardware',
    display: 'sh1106',
    secret: encrypted,
    wifi: { ssid: 'HomeWiFi', password: encrypted },
    ...overrides,
  };
}

describe('User', () => {
  it('needs no email or password', async () => {
    const user = await User.create({});
    assert.equal(user.name, 'My phone');
    assert.ok(user.toJSON().id);
    assert.equal(user.toJSON()._id, undefined);
  });
});

describe('Device', () => {
  it('has no members, no name and is idle by default', async () => {
    const device = await Device.create(newDevice({ _id: 'oled-aaaaa1' }));
    assert.equal(device.members.length, 0);
    assert.equal(device.name, null);
    assert.equal(device.mode, 'idle');
    assert.equal(device.online, false);
  });

  it('rejects a malformed device ID', async () => {
    await assert.rejects(
      Device.create(newDevice({ _id: 'OLED_1' })),
      mongoose.Error.ValidationError,
    );
  });

  it('rejects an unknown display', async () => {
    await assert.rejects(
      Device.create(newDevice({ _id: 'oled-aaaaa2', display: 'st7735' })),
      mongoose.Error.ValidationError,
    );
  });

  it('does not load secrets unless asked for', async () => {
    await Device.create(newDevice({ _id: 'oled-aaaaa3' }));
    const plain = await Device.findById('oled-aaaaa3');
    assert.equal(plain.secret, undefined);
    assert.equal(plain.wifi.password, undefined);

    const withSecret = await Device.findById('oled-aaaaa3').select('+secret +wifi.password');
    assert.equal(withSecret.secret.data, encrypted.data);
    assert.equal(withSecret.wifi.password.data, encrypted.data);
  });

  it('never puts secrets in JSON, even when selected', async () => {
    await Device.create(newDevice({ _id: 'oled-aaaaa4' }));
    const device = await Device.findById('oled-aaaaa4').select('+secret +wifi.password');
    const json = device.toJSON();
    assert.equal(json.id, 'oled-aaaaa4');
    assert.equal(json.secret, undefined);
    assert.equal(json.wifi.password, undefined);
    assert.equal(json.wifi.ssid, 'HomeWiFi');
  });

  it('tracks owner and member roles', async () => {
    const owner = await User.create({ name: 'Owner phone' });
    const member = await User.create({ name: 'Member phone' });
    const stranger = await User.create({ name: 'Stranger' });
    const device = await Device.create(
      newDevice({
        _id: 'oled-aaaaa5',
        members: [
          { user: owner._id, role: 'owner' },
          { user: member._id, role: 'member' },
        ],
      }),
    );

    assert.equal(device.roleOf(owner._id), 'owner');
    assert.equal(device.roleOf(member._id), 'member');
    assert.equal(device.roleOf(stranger._id), null);

    const loaded = await Device.findOne({ 'members.user': member._id }).populate('members.user');
    assert.equal(loaded.id, 'oled-aaaaa5');
    assert.equal(loaded.members[0].user.name, 'Owner phone');
  });

  it('nightly reset clears people data but keeps the login', async () => {
    const user = await User.create({});
    await Device.create(
      newDevice({
        _id: 'oled-aaaaa6',
        name: 'Desk',
        mode: 'eyes',
        online: true,
        members: [{ user: user._id, role: 'owner' }],
      }),
    );

    await Device.updateMany({}, { $set: NIGHTLY_RESET });

    const device = await Device.findById('oled-aaaaa6').select('+secret +wifi.password');
    assert.equal(device.name, null);
    assert.equal(device.members.length, 0);
    assert.equal(device.mode, 'idle');
    assert.equal(device.online, true);
    assert.equal(device.secret.data, encrypted.data);
    assert.equal(device.wifi.password.data, encrypted.data);
  });
});
