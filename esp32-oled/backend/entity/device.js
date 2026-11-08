import mongoose from 'mongoose';
import { newToken, randomString, seal } from '../utils/secrets.js';

const { Schema } = mongoose;

export const DEVICE_ID_PATTERN = /^oled-[a-z0-9]{6}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DUPLICATE_KEY = 11000;

// What the nightly cleanup resets. Everything else on a device survives,
// so a flashed board keeps connecting after midnight.
export const NIGHTLY_RESET = { name: null, controller: null, mode: 'idle' };

const sealedSchema = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false },
);

// The one phone playing with the device right now.
const controllerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    since: { type: Date, default: Date.now },
    // Bumped by tilt and mode changes; the idle timer reads it.
    lastActiveAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const deviceSchema = new Schema(
  {
    // Also the device's MQTT username, e.g. "oled-7k2m9q".
    _id: { type: String, match: DEVICE_ID_PATTERN },
    kind: { type: String, enum: ['hardware'], required: true },
    display: { type: String, enum: ['sh1106', 'ssd1306'], required: true },

    // MQTT password, only loaded when a query asks: .select('+secret').
    secret: { type: sealedSchema, required: true, select: false },

    // Reported by the device itself.
    online: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    fw: { version: String, gitSha: String, builtAt: Date },
    net: { rssi: Number, ip: String },

    // People data, reset nightly.
    name: { type: String, trim: true, maxlength: 40, default: null },
    controller: { type: controllerSchema, default: null },
    mode: { type: String, enum: ['idle', 'eyes', 'music'], default: 'idle' },
  },
  { timestamps: true, versionKey: false },
);

// A phone controls at most one device: enforced by the database itself.
deviceSchema.index(
  { 'controller.user': 1 },
  { unique: true, partialFilterExpression: { 'controller.user': { $exists: true } } },
);

// Creates a device with a random ID and secret. Returns the secret in plain
// text once, for the firmware to keep in flash; only the sealed copy is stored.
deviceSchema.statics.register = async function ({ kind, display, fw }) {
  const secret = newToken();
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const device = await this.create({
        _id: `oled-${randomString(ID_ALPHABET, 6)}`,
        kind,
        display,
        fw,
        secret: seal(secret),
      });
      return { device, secret };
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err;
    }
  }
  throw new Error('Could not generate a unique device ID');
};

// Makes `userId` the controller if the device is still free. Atomic, so two
// phones racing for one device can't both win. Returns the device or null.
deviceSchema.statics.claim = function (deviceId, userId, now = new Date()) {
  return this.findOneAndUpdate(
    { _id: deviceId, controller: null },
    { $set: { controller: { user: userId, since: now, lastActiveAt: now } } },
    { returnDocument: 'after' },
  );
};

// Clears the controller. Returns the device as it was, or null if it had none.
deviceSchema.statics.unclaim = function (deviceId) {
  return this.findOneAndUpdate(
    { _id: deviceId, controller: { $ne: null } },
    { $set: { controller: null } },
  );
};

deviceSchema.statics.controlledBy = function (userId) {
  return this.findOne({ 'controller.user': userId });
};

deviceSchema.methods.isControlledBy = function (userId) {
  return Boolean(this.controller?.user.equals(userId));
};

// What the controlling phone sees.
deviceSchema.methods.toPhoneJSON = function () {
  return {
    id: this._id,
    name: this.name,
    kind: this.kind,
    display: this.display,
    online: this.online,
    lastSeenAt: this.lastSeenAt,
    mode: this.mode,
    since: this.controller?.since ?? null,
  };
};

// Default JSON (admin API): never includes the secret, even when selected.
deviceSchema.set('toJSON', {
  transform: (_doc, json) => {
    json.id = json._id;
    delete json._id;
    delete json.secret;
    return json;
  },
});

export const Device = mongoose.model('Device', deviceSchema);
