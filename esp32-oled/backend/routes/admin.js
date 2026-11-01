import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { runCleanup } from '../utils/cleanup.js';

// Mounted at /api/admin behind requireAdmin.

const wifiSchema = z.object({
  ssid: z
    .string()
    .min(1, 'is required')
    .refine((ssid) => Buffer.byteLength(ssid) <= 32, 'must be at most 32 bytes'),
  // WPA2 passphrases are 8–63 characters; empty means an open network.
  password: z.string().refine((pw) => pw === '' || (pw.length >= 8 && pw.length <= 63), {
    message: 'must be empty (open network) or 8–63 characters',
  }),
});

const newDeviceSchema = z
  .object({
    kind: z.enum(['hardware', 'simulator']),
    display: z.enum(['sh1106', 'ssd1306']),
    wifi: wifiSchema.optional(),
  })
  .refine((d) => d.kind === 'simulator' || d.wifi, {
    path: ['wifi'],
    message: 'is required for hardware devices',
  })
  // Wokwi has no SH1106 part.
  .refine((d) => d.kind === 'hardware' || d.display === 'ssd1306', {
    path: ['display'],
    message: 'must be ssd1306 for simulators',
  });

const wifiChangeSchema = z.object({ wifi: wifiSchema });

const router = Router();

router.get('/devices', listDevices);
router.post('/devices', validate(newDeviceSchema), registerDevice);
router.get('/devices/:id', getDevice);
router.patch('/devices/:id', validate(wifiChangeSchema), changeWifi);
router.delete('/devices/:id', deleteDevice);
router.post('/devices/:id/rotate-secret', rotateSecret);
router.get('/devices/:id/env', downloadEnvFile);
router.post('/devices/:id/pairing-codes', createOwnerPairingCode);
router.post('/cleanup', cleanupNow);

export default router;

async function listDevices(_req, res) {
  const devices = await Device.find().sort({ createdAt: -1 }).populate('members.user', 'name');
  res.json({ devices });
}

async function registerDevice(req, res) {
  const { device, secret } = await Device.register(req.body);
  // TODO(mqtt): create the device's MQTT login; undo the registration if that fails.
  await DeviceEvent.record(device._id, 'created', { kind: device.kind, display: device.display });

  res.status(201).json({ device, envFile: device.envFile(secret) });
}

async function getDevice(req, res) {
  const device = await findDevice(req.params.id);
  await device.populate('members.user', 'name');
  const events = await DeviceEvent.find({ device: device._id }).sort({ at: -1 }).limit(50);

  res.json({ device, events });
}

async function changeWifi(req, res) {
  const device = await findDevice(req.params.id);
  device.setWifi(req.body.wifi);
  await device.save();
  await DeviceEvent.record(device._id, 'wifi_changed', { ssid: device.wifi.ssid });

  res.json({ device, rebuildRequired: true });
}

async function deleteDevice(req, res) {
  const device = await findDevice(req.params.id);
  // TODO(mqtt): delete the device's MQTT login, which also disconnects it.
  await Promise.all([
    device.deleteOne(),
    PairingCode.deleteMany({ device: device._id }),
    DeviceEvent.deleteMany({ device: device._id }),
  ]);

  res.status(204).end();
}

async function rotateSecret(req, res) {
  const device = await findDevice(req.params.id, { withSecrets: true });
  const secret = device.rotateSecret();
  await device.save();
  // TODO(mqtt): replace the device's MQTT login, which disconnects the old secret.
  await DeviceEvent.record(device._id, 'rotate', { secretVersion: device.secretVersion });

  res.json({ device, envFile: device.envFile(secret), rebuildRequired: true });
}

async function downloadEnvFile(req, res) {
  const device = await findDevice(req.params.id, { withSecrets: true });

  res
    .type('text/plain')
    .set('Content-Disposition', `attachment; filename="${device._id}.env"`)
    .set('Cache-Control', 'no-store')
    .send(device.envFile());
}

// The first phone to scan becomes the owner, replacing any previous owner.
async function createOwnerPairingCode(req, res) {
  const device = await findDevice(req.params.id);
  const pairing = await PairingCode.issue({
    device: device._id,
    role: 'owner',
    createdBy: { kind: 'admin' },
  });

  res.status(201).json(pairing);
}

async function cleanupNow(_req, res) {
  res.json(await runCleanup('manual, from the admin API'));
}

async function findDevice(id, { withSecrets = false } = {}) {
  const device = withSecrets ? await Device.findWithSecrets(id) : await Device.findById(id);
  if (!device) throw notFound('device_not_found', 'No such device');
  return device;
}
