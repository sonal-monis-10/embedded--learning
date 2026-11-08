import mongoose from 'mongoose';
import { config } from '../utils/config.js';
import { hashToken, newToken } from '../utils/secrets.js';
import { nextMidnight } from '../utils/time.js';

const { Schema } = mongoose;

// A paired phone's login. The phone keeps the token; only its hash is stored.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, maxlength: 300, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Every session ends at the next midnight, when the cleanup wipes users.
sessionSchema.statics.start = async function (user, userAgent = '') {
  const token = newToken();
  const session = await this.create({
    user: user._id,
    tokenHash: hashToken(token),
    userAgent: userAgent.slice(0, 300),
    expiresAt: nextMidnight(config.cleanupTimeZone),
  });
  return { token, session };
};

// The live session for `token`, with its user, or null. Checks expiry
// itself, since MongoDB's TTL deletion can lag by a minute.
sessionSchema.statics.findActive = function (token) {
  const now = new Date();
  return this.findOneAndUpdate(
    { tokenHash: hashToken(token), expiresAt: { $gt: now } },
    { $set: { lastUsedAt: now } },
    { returnDocument: 'after' },
  ).populate('user');
};

export const Session = mongoose.model('Session', sessionSchema);
