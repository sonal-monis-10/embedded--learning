import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Device } from '../entity/device.js';
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
    name: 'Desk OLED',
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
  it('is unclaimed and idle by default', async () => {
    const device = await Device.create(newDevice({ _id: 'oled-aaaaa1' }));
    assert.equal(device.owner, null);
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

  it('links to the user who paired it', async () => {
    const user = await User.create({ name: 'Test phone' });
    const device = await Device.create(newDevice({ _id: 'oled-aaaaa5', owner: user._id }));
    const loaded = await Device.findById(device._id).populate('owner');
    assert.equal(loaded.owner.name, 'Test phone');
  });
});
