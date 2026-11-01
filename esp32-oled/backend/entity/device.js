import mongoose from 'mongoose';

const { Schema } = mongoose;

export const DEVICE_ID_PATTERN = /^oled-[a-z0-9]{6}$/;

// AES-256-GCM output (all base64). The key is SECRETS_KEY in the environment,
// never in the database, so a database copy alone reveals no secrets.
const encryptedSchema = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false },
);

// A phone that paired by scanning a QR code. The admin's pairing QR makes
// the scanner the owner; the owner's "Add phone" QR makes a member.
const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// The nightly cleanup resets these to their defaults; everything else on a
// device (its login, Wi-Fi, live status) is kept.
export const NIGHTLY_RESET = { name: null, members: [], mode: 'idle' };

const deviceSchema = new Schema(
  {
    // ---- Kept forever: the firmware is built with these ----

    // The device ID doubles as its MQTT username, e.g. "oled-7k2m9q".
    _id: { type: String, match: DEVICE_ID_PATTERN },
    kind: { type: String, enum: ['hardware', 'simulator'], required: true },
    display: { type: String, enum: ['sh1106', 'ssd1306'], required: true },

    // MQTT password. `select: false` keeps it out of every query unless a
    // caller asks for it explicitly with .select('+secret').
    secret: { type: encryptedSchema, required: true, select: false },
    secretVersion: { type: Number, default: 1 },

    wifi: {
      ssid: { type: String, maxlength: 32, default: '' },
      password: { type: encryptedSchema, select: false },
    },

    // ---- Kept, refreshed by the device's retained `status` messages ----
    online: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    fw: {
      version: String,
      gitSha: String,
      builtAt: Date,
    },
    net: {
      rssi: Number,
      ip: String,
    },

    // ---- Reset every night (NIGHTLY_RESET) ----

    // Set by the owner after pairing, e.g. "Sonal's desk". The UI falls back
    // to the device ID while it is null.
    name: { type: String, trim: true, maxlength: 40, default: null },
    members: { type: [memberSchema], default: [] },
    mode: { type: String, enum: ['idle', 'eyes', 'music'], default: 'idle' },
  },
  { timestamps: true, versionKey: false },
);

// "Which devices can this phone control?" runs on every request.
deviceSchema.index({ 'members.user': 1 });

deviceSchema.methods.roleOf = function roleOf(userId) {
  // m.user is an ObjectId, or a User document after populate().
  const member = this.members.find((m) => (m.user._id ?? m.user).equals(userId));
  return member ? member.role : null;
};

// What a paired phone sees: no Wi-Fi, no secrets, and its own role.
deviceSchema.methods.forUser = function forUser(userId) {
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

// API responses: `id` instead of `_id`, and never any secret, even if a
// caller selected it.
deviceSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.secret;
    if (ret.wifi) delete ret.wifi.password;
    return ret;
  },
});

export const Device = mongoose.model('Device', deviceSchema);
