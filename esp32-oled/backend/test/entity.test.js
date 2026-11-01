import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Device, NIGHTLY_RESET } from '../entity/device.js';
import { CODE_ALPHABET, normalizeCode, PairingCode } from '../entity/pairingCode.js';
import { User } from '../entity/user.js';
import { unseal } from '../utils/secrets.js';
import { startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

const registerHardware = () => Device.register({ kind: 'hardware', display: 'sh1106' });

describe('User', () => {
  it('needs no email or password', async () => {
    const user = await User.create({});
    assert.equal(user.name, 'My phone');
    assert.ok(user.toJSON().id);
  });
});

describe('Device.register', () => {
  it('creates a free, idle device with a sealed secret', async () => {
    const { device, secret } = await registerHardware();
    assert.match(device.id, /^oled-[a-z0-9]{6}$/);
    assert.equal(device.controller, null);
    assert.equal(device.mode, 'idle');
    assert.equal(unseal(device.secret), secret);
  });

  it('rejects an unknown display', async () => {
    await assert.rejects(
      Device.register({ kind: 'hardware', display: 'st7735' }),
      mongoose.Error.ValidationError,
    );
  });

  it('never loads the secret unless asked, and never puts it in JSON', async () => {
    const { device } = await registerHardware();
    assert.equal((await Device.findById(device.id)).secret, undefined);
    const full = await Device.findById(device.id).select('+secret');
    assert.ok(full.secret.data);
    assert.equal(full.toJSON().secret, undefined);
  });
});

describe('Device controller', () => {
  it('claim succeeds once; a second phone cannot take a taken device', async () => {
    const [a, b] = await User.create([{}, {}]);
    const { device } = await registerHardware();

    assert.ok(await Device.claim(device.id, a._id));
    assert.equal(await Device.claim(device.id, b._id), null);
    assert.ok((await Device.findById(device.id)).isControlledBy(a._id));
  });

  it('a phone cannot control two devices (database rule)', async () => {
    const user = await User.create({});
    const first = await registerHardware();
    const second = await registerHardware();
    await Device.claim(first.device.id, user._id);
    await assert.rejects(Device.claim(second.device.id, user._id), { code: 11000 });
  });

  it('unclaim frees the device and reports whether it was taken', async () => {
    const user = await User.create({});
    const { device } = await registerHardware();
    await Device.claim(device.id, user._id);
    assert.ok(await Device.unclaim(device.id));
    assert.equal(await Device.unclaim(device.id), null);
    assert.equal(await Device.controlledBy(user._id), null);
  });

  it('the nightly reset frees devices and keeps their login', async () => {
    const user = await User.create({});
    const { device, secret } = await registerHardware();
    await Device.claim(device.id, user._id);
    await Device.updateOne({ _id: device.id }, { name: 'Desk', mode: 'eyes', online: true });

    await Device.updateMany({}, { $set: NIGHTLY_RESET });

    const reset = await Device.findById(device.id).select('+secret');
    assert.equal(reset.controller, null);
    assert.equal(reset.name, null);
    assert.equal(reset.mode, 'idle');
    assert.equal(reset.online, true);
    assert.equal(unseal(reset.secret), secret);
  });
});

describe('PairingCode', () => {
  it('uses 8 characters without look-alikes and links to the frontend', async () => {
    assert.doesNotMatch(CODE_ALPHABET, /[01ILO]/);
    const { code, url } = await PairingCode.issue('oled-aaaaaa');
    assert.match(code, new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    assert.equal(url, `http://localhost:5173/pair/${code}`);
  });

  it('normalizes typed codes', () => {
    assert.equal(normalizeCode(' k3f9-qxw2 '), 'K3F9QXW2');
  });

  it('can be redeemed once', async () => {
    const { code } = await PairingCode.issue('oled-aaaaab');
    assert.ok(await PairingCode.redeem(code.toLowerCase()));
    assert.equal(await PairingCode.redeem(code), null);
  });

  it('findLive ignores codes about to expire', async () => {
    await PairingCode.issue('oled-aaaaac');
    assert.ok(await PairingCode.findLive('oled-aaaaac'));
    assert.equal(await PairingCode.findLive('oled-aaaaac', 3 * 60_000), null);
  });
});
