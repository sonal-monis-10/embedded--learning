import mongoose from 'mongoose';

const { Schema } = mongoose;

export const DEVICE_EVENT_TYPES = [
  'created',
  'wifi_changed',
  'rotate',
  'paired',
  'member_removed',
  'connect',
  'disconnect',
  'auth_fail',
];

// What happened to a device today, shown on the admin page. Deleted by the
// nightly cleanup.
const deviceEventSchema = new Schema(
  {
    device: { type: String, ref: 'Device', required: true },
    type: { type: String, enum: DEVICE_EVENT_TYPES, required: true },
    at: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);

deviceEventSchema.index({ device: 1, at: -1 });

deviceEventSchema.statics.record = function record(device, type, meta = {}) {
  return this.create({ device, type, meta });
};

export const DeviceEvent = mongoose.model('DeviceEvent', deviceEventSchema);
