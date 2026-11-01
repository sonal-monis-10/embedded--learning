import mongoose from 'mongoose';

const { Schema } = mongoose;

// A user is a phone (or browser) that paired by scanning a device's QR code
// and typed a name. There is no email or password: the user is identified
// by the session token issued at pairing time. All users are deleted by the
// nightly cleanup (00:00 IST); people pair again the next day.
const userSchema = new Schema(
  {
    // Shown in session/member lists, e.g. "Sonal's iPhone". Editable later.
    name: { type: String, trim: true, maxlength: 40, default: 'My phone' },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
