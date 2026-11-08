import mongoose from 'mongoose';

const { Schema } = mongoose;

// Songs fetched from LRCLIB, kept for good: lyrics don't change, and this
// keeps a chosen song working when LRCLIB is down. _id is LRCLIB's ID.
const songSchema = new Schema(
  {
    _id: { type: Number },
    title: { type: String, required: true },
    artist: { type: String, default: '' },
    album: { type: String, default: '' },
    durationMs: { type: Number, required: true },
    // 'synced': timed lines the OLED can show; 'other-script': timed, but
    // not in Latin letters; 'none': no timed lyrics.
    lyrics: { type: String, enum: ['synced', 'other-script', 'none'], required: true },
    lines: { type: [{ _id: false, t: Number, text: String }], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export const Song = mongoose.model('Song', songSchema);
