import mongoose from 'mongoose';
import { config } from '../utils/config.js';
import { hashToken, randomString } from '../utils/secrets.js';

const { Schema } = mongoose;

// No look-alikes (0/O, 1/I/L), so a code can be typed if a camera won't scan.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const CODE_LIFETIME_MS = 2 * 60 * 1000;

// The one-time code a free device shows on its OLED (as a QR and as text).
// Redeeming it makes the phone the device's controller. Only the hash is stored.
const pairingCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    device: { type: String, ref: 'Device', required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

pairingCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Returns what the device needs to draw: the code, the QR link, and when it expires.
pairingCodeSchema.statics.issue = async function (deviceId, now = new Date()) {
  const code = randomString(CODE_ALPHABET, CODE_LENGTH);
  const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS);
  await this.create({ codeHash: hashToken(code), device: deviceId, expiresAt });
  return { code, url: `${config.frontendUrl}/pair/${code}`, expiresAt };
};

// Marks the code used and returns it, or null if it is wrong, used or
// expired. Atomic, so two phones scanning the same QR can't both win.
pairingCodeSchema.statics.redeem = function (typedCode) {
  const now = new Date();
  return this.findOneAndUpdate(
    { codeHash: hashToken(normalizeCode(typedCode)), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  );
};

// Unused codes that are still valid for longer than `marginMs`.
pairingCodeSchema.statics.findLive = function (deviceId, marginMs = 0) {
  return this.findOne({
    device: deviceId,
    usedAt: null,
    expiresAt: { $gt: new Date(Date.now() + marginMs) },
  });
};

// People type codes in lower case, or with the dash shown on screen.
export function normalizeCode(typed) {
  return String(typed).toUpperCase().replace(/[\s-]/g, '');
}

export const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
