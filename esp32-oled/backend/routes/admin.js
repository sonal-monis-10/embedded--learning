import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { requireAdmin, requireProvisionKey } from '../middleware/auth.js';
import { createDeviceLogin, deleteDeviceLogin } from '../mqtt/logins.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { adminKeyLimiter, provisionLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { runCleanup } from '../utils/cleanup.js';
import { config } from '../utils/config.js';
import { release } from '../utils/turns.js';

// Mounted at /api/admin. Two keys guard it: firmware registers itself with
// the PROVISION_KEY; everything else is maintenance with the ADMIN_KEY.

const provisionSchema = z
  .object({
    kind: z.enum(['hardware', 'simulator']),
    display: z.enum(['sh1106', 'ssd1306']),
    fw: z
      .object({
        version: z.string().max(32).optional(),
        gitSha: z.string().max(40).optional(),
        builtAt: z.coerce.date().optional(),
      })
      .optional(),
  })
  // Wokwi has no SH1106 part.
  .refine((d) => d.kind === 'hardware' || d.display === 'ssd1306', {
    path: ['display'],
    message: 'must be ssd1306 for simulators',
  });

const admin = [adminKeyLimiter, requireAdmin];

const router = Router();

router.post(
  '/devices',
  provisionLimiter,
  requireProvisionKey,
  validate(provisionSchema),
  provision,
);
router.get('/devices', admin, listDevices);
router.get('/devices/:id', admin, getDevice);
router.delete('/devices/:id', admin, deleteDevice);
router.post('/devices/:id/release', admin, releaseDevice);
router.post('/cleanup', admin, cleanupNow);

export default router;

// First boot: the firmware has no credentials yet and asks for its own.
async function provision(req, res) {
  if ((await Device.countDocuments()) >= config.maxDevices) {
    throw new HttpError(409, 'device_limit', 'No more devices can be registered');
  }
  const { device, secret } = await Device.register(req.body);
  try {
    await createDeviceLogin(device._id, secret);
  } catch (err) {
    await device.deleteOne(); // no half-registered devices
    throw err;
  }
  await DeviceEvent.record(device._id, 'provisioned', { kind: device.kind, fw: device.fw });

  res.status(201).json({ deviceId: device._id, secret, brokerUrl: config.publicMqttUrl });
}

async function listDevices(_req, res) {
  const devices = await Device.find().sort({ createdAt: -1 }).populate('controller.user', 'name');
  res.json({ devices });
}

async function getDevice(req, res) {
  const device = await findDevice(req.params.id);
  await device.populate('controller.user', 'name');
  const events = await DeviceEvent.find({ device: device._id }).sort({ at: -1 }).limit(50);
  res.json({ device, events });
}

// The device re-provisions with a new ID on its next boot, once the broker
// rejects its old login.
async function deleteDevice(req, res) {
  const device = await findDevice(req.params.id);
  await deleteDeviceLogin(device._id); // also disconnects it
  await Promise.all([
    device.deleteOne(),
    PairingCode.deleteMany({ device: device._id }),
    DeviceEvent.deleteMany({ device: device._id }),
  ]);
  res.status(204).end();
}

async function releaseDevice(req, res) {
  const device = await findDevice(req.params.id);
  res.json({ released: await release(device._id, 'admin') });
}

async function cleanupNow(_req, res) {
  res.json(await runCleanup('manual, from the admin API'));
}

async function findDevice(id) {
  const device = await Device.findById(id);
  if (!device) throw notFound('device_not_found', 'No such device');
  return device;
}
