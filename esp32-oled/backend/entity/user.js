import mongoose from 'mongoose';

const { Schema } = mongoose;

// A phone that paired by scanning a QR and typing a name. No email or
// password. Deleted every night; people pair again the next day.
const userSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 40, default: 'My phone' },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

userSchema.set('toJSON', {
  transform: (_doc, json) => {
    json.id = json._id.toString();
    delete json._id;
    return json;
  },
});

export const User = mongoose.model('User', userSchema);
