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

const deviceSchema = new Schema(
  {
    // The device ID doubles as its MQTT username, e.g. "oled-7k2m9q".
    _id: { type: String, match: DEVICE_ID_PATTERN },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    kind: { type: String, enum: ['hardware', 'simulator'], required: true },
    display: { type: String, enum: ['sh1106', 'ssd1306'], required: true },

    // The user who claimed the device by scanning its pairing QR code.
    // null until someone pairs.
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // MQTT password. `select: false` keeps it out of every query unless a
    // caller asks for it explicitly with .select('+secret').
    secret: { type: encryptedSchema, required: true, select: false },
    secretVersion: { type: Number, default: 1 },

    wifi: {
      ssid: { type: String, maxlength: 32, default: '' },
      password: { type: encryptedSchema, select: false },
    },

    // Kept up to date from the device's retained `status` messages.
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

    mode: { type: String, enum: ['idle', 'eyes', 'music'], default: 'idle' },
  },
  { timestamps: true, versionKey: false },
);

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
