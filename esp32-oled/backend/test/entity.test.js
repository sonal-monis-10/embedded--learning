import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Device, NIGHTLY_RESET } from '../entity/device.js';
import { CODE_ALPHABET, normalizeCode, PairingCode } from '../entity/pairingCode.js';
import { User } from '../entity/user.js';
import { unseal } from '../utils/secrets.js';
import { parseEnvFile, startApp } from './support/app.js';

let t;
before(async () => (t = await startApp()));
after(() => t.stop());

const homeWifi = { ssid: 'HomeWiFi', password: 'correct horse' };
const registerHardware = (wifi = homeWifi) =>
  Device.register({ kind: 'hardware', display: 'sh1106', wifi });
const registerSimulator = () => Device.register({ kind: 'simulator', display: 'ssd1306' });

describe('User', () => {
  it('needs no email or password', async () => {
    const user = await User.create({});
    assert.equal(user.name, 'My phone');
    assert.ok(user.toJSON().id);
  });
});

describe('Device.register', () => {
  it('creates an unpaired, idle device with sealed secrets', async () => {
    const { device, secret } = await registerHardware();
    assert.match(device.id, /^oled-[a-z0-9]{6}$/);
    assert.equal(device.members.length, 0);
    assert.equal(device.mode, 'idle');
    assert.equal(unseal(device.secret), secret);
    assert.equal(unseal(device.wifi.password), homeWifi.password);
  });

  it('uses Wokwi Wi-Fi for simulators', async () => {
    const { device } = await registerSimulator();
    assert.equal(device.wifi.ssid, 'Wokwi-GUEST');
    assert.equal(device.wifi.password, undefined);
  });

  it('rejects an unknown display', async () => {
    await assert.rejects(
      Device.register({ kind: 'hardware', display: 'st7735', wifi: homeWifi }),
      mongoose.Error.ValidationError,
    );
  });
});

describe('Device secrets', () => {
  it('are loaded only on request, and never appear in JSON', async () => {
    const { device } = await registerHardware();

    const plain = await Device.findById(device.id);
    assert.equal(plain.secret, undefined);
    assert.equal(plain.wifi.password, undefined);

    const json = (await Device.findWithSecrets(device.id)).toJSON();
    assert.equal(json.secret, undefined);
    assert.equal(json.wifi.password, undefined);
  });

  it('envFile keeps special characters intact', async () => {
    const wifi = { ssid: 'My "Home" #2', password: 'pa ss\\word#' };
    const { device, secret } = await registerHardware(wifi);

    const env = parseEnvFile(device.envFile(secret));
    assert.equal(env.DEVICE_ID, device.id);
    assert.equal(env.DEVICE_SECRET, secret);
    assert.equal(env.WIFI_SSID, wifi.ssid);
    assert.equal(env.WIFI_PASS, wifi.password);
  });

  it('rotateSecret replaces the secret and bumps the version', async () => {
    const { device, secret } = await registerSimulator();
    const newSecret = device.rotateSecret();
    assert.notEqual(newSecret, secret);
    assert.equal(unseal(device.secret), newSecret);
    assert.equal(device.secretVersion, 2);
  });
});

describe('Device members', () => {
  it('an owner code replaces the owner', async () => {
    const [oldOwner, newOwner, member] = await User.create([{}, {}, {}]);
    const { device } = await registerSimulator();

    device.addMember(oldOwner._id, 'owner');
    device.addMember(member._id, 'member');
    device.addMember(newOwner._id, 'owner');

    assert.equal(device.roleOf(oldOwner._id), null);
    assert.equal(device.roleOf(newOwner._id), 'owner');
    assert.equal(device.roleOf(member._id), 'member');
  });

  it('a member code never downgrades the owner', async () => {
    const owner = await User.create({});
    const { device } = await registerSimulator();
    device.addMember(owner._id, 'owner');
    device.addMember(owner._id, 'member');
    assert.equal(device.roleOf(owner._id), 'owner');
    assert.equal(device.members.length, 1);
  });

  it('removeMember says whether someone was removed', async () => {
    const user = await User.create({});
    const { device } = await registerSimulator();
    device.addMember(user._id, 'member');
    assert.equal(device.removeMember(user._id), true);
    assert.equal(device.removeMember(user._id), false);
  });

  it('the nightly reset clears people data and keeps the login', async () => {
    const user = await User.create({});
    const { device, secret } = await registerSimulator();
    device.set({ name: 'Desk', mode: 'eyes', online: true });
    device.addMember(user._id, 'owner');
    await device.save();

    await Device.updateMany({}, { $set: NIGHTLY_RESET });

    const reset = await Device.findWithSecrets(device.id);
    assert.equal(reset.name, null);
    assert.equal(reset.members.length, 0);
    assert.equal(reset.mode, 'idle');
    assert.equal(reset.online, true);
    assert.equal(unseal(reset.secret), secret);
  });
});

describe('PairingCode', () => {
  const issue = () =>
    PairingCode.issue({ device: 'oled-aaaaaa', role: 'owner', createdBy: { kind: 'admin' } });

  it('uses 8 characters without look-alikes', async () => {
    assert.doesNotMatch(CODE_ALPHABET, /[01ILO]/);
    for (let i = 0; i < 20; i++) {
      const { code } = await issue();
      assert.match(code, new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    }
  });

  it('normalizes typed codes', () => {
    assert.equal(normalizeCode(' k3f9-qxw2 '), 'K3F9QXW2');
  });

  it('can be redeemed once', async () => {
    const { code } = await issue();
    assert.ok(await PairingCode.redeem(code.toLowerCase()));
    assert.equal(await PairingCode.redeem(code), null);
  });
});
