import mongoose from 'mongoose';

const { Schema } = mongoose;

// Values the backend must remember across restarts, kept by the cleanup.
// Today: { _id: 'cleanup', lastRunDate: '2026-11-01' }.
const metaSchema = new Schema(
  {
    _id: { type: String },
    lastRunDate: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'meta' },
);

export const Meta = mongoose.model('Meta', metaSchema);
