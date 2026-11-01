import mongoose from 'mongoose';
import { config } from '../utils/config.js';
import { hashToken, randomString } from '../utils/secrets.js';

const { Schema } = mongoose;

// No look-alikes (0/O, 1/I/L), so a code can be typed if a camera won't scan.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
const LIFETIME_MS = 2 * 60 * 1000;

// The one-time code inside a pairing QR. Only its hash is stored.
const pairingCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    device: { type: String, ref: 'Device', required: true },
    role: { type: String, enum: ['owner', 'member'], required: true },
    createdBy: {
      kind: { type: String, enum: ['admin', 'user'], required: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

pairingCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Returns the code and the link that goes into the QR.
pairingCodeSchema.statics.issue = async function ({ device, role, createdBy }) {
  const code = randomString(CODE_ALPHABET, CODE_LENGTH);
  const expiresAt = new Date(Date.now() + LIFETIME_MS);
  await this.create({ codeHash: hashToken(code), device, role, createdBy, expiresAt });
  return { code, role, expiresAt, url: `${config.frontendUrl}/pair/${code}` };
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

// People type codes in lower case, or with the dash shown on screen.
export function normalizeCode(typed) {
  return String(typed).toUpperCase().replace(/[\s-]/g, '');
}

export const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
