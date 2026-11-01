import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000;

// A one-time code inside a pairing QR. Scanning it adds the phone to
// `device` with `role`. Only the hash is stored.
const pairingCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    device: { type: String, ref: 'Device', required: true },
    // 'owner' codes come from the admin page, 'member' codes from the owner's phone.
    role: { type: String, enum: ['owner', 'member'], required: true },
    createdBy: {
      kind: { type: String, enum: ['admin', 'user'], required: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    expiresAt: { type: Date, required: true },
    // Set atomically when the code is redeemed, so it can't be used twice.
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

pairingCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
