import mongoose from 'mongoose';

const { Schema } = mongoose;

// Today's history of a device, shown on the admin page. Wiped nightly.
const deviceEventSchema = new Schema(
  {
    device: { type: String, ref: 'Device', required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'created',
        'wifi_changed',
        'rotate',
        'paired',
        'member_removed',
        'connect',
        'disconnect',
        'auth_fail',
      ],
    },
    at: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);

deviceEventSchema.index({ device: 1, at: -1 });

deviceEventSchema.statics.record = function (device, type, meta = {}) {
  return this.create({ device, type, meta });
};

export const DeviceEvent = mongoose.model('DeviceEvent', deviceEventSchema);
