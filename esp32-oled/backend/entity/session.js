import mongoose from 'mongoose';

const { Schema } = mongoose;

// A phone's login, created when it pairs. The phone keeps the random token;
// only its SHA-256 hash is stored, so a database copy can't be used to log in.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, maxlength: 300, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    // The next 00:00 in CLEANUP_TZ. The auth middleware rejects the session
    // from this moment, even before the nightly cleanup has run.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// MongoDB deletes expired sessions by itself (checked about once a minute).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
