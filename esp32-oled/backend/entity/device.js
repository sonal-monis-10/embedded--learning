import mongoose from 'mongoose';
import { config } from '../utils/config.js';
import { newToken, randomString, seal, unseal } from '../utils/secrets.js';

const { Schema } = mongoose;

export const DEVICE_ID_PATTERN = /^oled-[a-z0-9]{6}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const WOKWI_WIFI = { ssid: 'Wokwi-GUEST', password: '' };
const DUPLICATE_KEY = 11000;

// What the nightly cleanup resets. Everything else on a device survives,
// so a flashed board keeps connecting after midnight.
export const NIGHTLY_RESET = { name: null, members: [], mode: 'idle' };

const sealedSchema = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false },
);

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const deviceSchema = new Schema(
  {
    // Also the device's MQTT username.
    _id: { type: String, match: DEVICE_ID_PATTERN },
    kind: { type: String, enum: ['hardware', 'simulator'], required: true },
    display: { type: String, enum: ['sh1106', 'ssd1306'], required: true },

    // Secrets are only loaded when a query asks for them: .select('+secret').
    secret: { type: sealedSchema, required: true, select: false },
    secretVersion: { type: Number, default: 1 },
    wifi: {
      ssid: { type: String, maxlength: 32, default: '' },
      password: { type: sealedSchema, select: false },
    },

    // Reported by the device itself.
    online: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    fw: { version: String, gitSha: String, builtAt: Date },
    net: { rssi: Number, ip: String },

    // People data, reset nightly.
    name: { type: String, trim: true, maxlength: 40, default: null },
    members: { type: [memberSchema], default: [] },
    mode: { type: String, enum: ['idle', 'eyes', 'music'], default: 'idle' },
  },
  { timestamps: true, versionKey: false },
);

deviceSchema.index({ 'members.user': 1 });

// ---- Registration and secrets ----

// Creates a device with a random ID and secret. Returns the secret in plain
// text once, for its .env file; only the sealed copy is stored.
deviceSchema.statics.register = async function ({ kind, display, wifi }) {
  const secret = newToken();
  const fields = {
    kind,
    display,
    secret: seal(secret),
    wifi: sealWifi(kind === 'simulator' ? WOKWI_WIFI : wifi),
  };

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const device = await this.create({ _id: newDeviceId(), ...fields });
      return { device, secret };
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err;
    }
  }
  throw new Error('Could not generate a unique device ID');
};

deviceSchema.statics.findWithSecrets = function (id) {
  return this.findById(id).select('+secret +wifi.password');
};

deviceSchema.methods.setWifi = function (wifi) {
  this.wifi = sealWifi(wifi);
};

// Returns the new secret in plain text, for the device's new .env file.
deviceSchema.methods.rotateSecret = function () {
  const secret = newToken();
  this.secret = seal(secret);
  this.secretVersion += 1;
  return secret;
};

// The devices/<id>.env file the firmware build reads. Values are JSON
// strings, so Wi-Fi passwords with spaces, '#' or quotes survive.
// Needs the Wi-Fi password loaded, and the secret unless it is passed in.
deviceSchema.methods.envFile = function (secret = unseal(this.secret)) {
  const values = {
    DEVICE_ID: this._id,
    DEVICE_SECRET: secret,
    BROKER_URL: config.publicMqttUrl,
    WIFI_SSID: this.wifi.ssid,
    WIFI_PASS: this.wifi.password ? unseal(this.wifi.password) : '',
  };
  const lines = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return [
    `# Device ${this._id}: SECRET, never commit or share this file.`,
    `# Build with: make firmware DEVICE=${this._id}`,
    ...lines,
    '',
  ].join('\n');
};

// ---- Members ----

deviceSchema.methods.roleOf = function (userId) {
  return this.members.find((m) => idOf(m.user).equals(userId))?.role ?? null;
};

// An owner code replaces the current owner (e.g. a lost phone). A member
// code never downgrades someone who is already on the device.
deviceSchema.methods.addMember = function (userId, role) {
  if (role === 'owner') {
    this.members = this.members.filter((m) => m.role !== 'owner' && !idOf(m.user).equals(userId));
    this.members.push({ user: userId, role: 'owner' });
  } else if (!this.roleOf(userId)) {
    this.members.push({ user: userId, role: 'member' });
  }
};

// Returns false if the user wasn't a member.
deviceSchema.methods.removeMember = function (userId) {
  const before = this.members.length;
  this.members = this.members.filter((m) => !idOf(m.user).equals(userId));
  return this.members.length < before;
};

// ---- JSON ----

// What a paired phone sees: its own role, nothing about Wi-Fi or secrets.
deviceSchema.methods.toPhoneJSON = function (userId) {
  return {
    id: this._id,
    name: this.name,
    kind: this.kind,
    display: this.display,
    online: this.online,
    lastSeenAt: this.lastSeenAt,
    fw: this.fw,
    net: this.net,
    mode: this.mode,
    role: this.roleOf(userId),
    memberCount: this.members.length,
  };
};

// Default JSON (admin API): never includes secrets, even when selected.
deviceSchema.set('toJSON', {
  transform: (_doc, json) => {
    json.id = json._id;
    delete json._id;
    delete json.secret;
    if (json.wifi) delete json.wifi.password;
    return json;
  },
});

function newDeviceId() {
  return `oled-${randomString(ID_ALPHABET, 6)}`;
}

function sealWifi({ ssid, password }) {
  return { ssid, password: password ? seal(password) : undefined };
}

// A member's `user` is an ObjectId, or a User document after populate().
function idOf(user) {
  return user._id ?? user;
}

export const Device = mongoose.model('Device', deviceSchema);
