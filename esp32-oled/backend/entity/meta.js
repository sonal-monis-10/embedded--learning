import mongoose from 'mongoose';

const { Schema } = mongoose;

// Small key/value records the backend needs to remember across restarts.
// Currently one: { _id: 'cleanup', lastRunDate: '2026-11-01' }.
// Kept by the nightly cleanup.
const metaSchema = new Schema(
  {
    _id: { type: String },
    lastRunDate: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'meta' },
);

export const Meta = mongoose.model('Meta', metaSchema);
