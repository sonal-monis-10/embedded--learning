import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { encrypt, decrypt, randomToken, randomString } from '../utils/crypto.js';
import { buildEnvFile } from '../utils/envFile.js';
import { createPairingCode } from '../utils/pairing.js';
import { runCleanup } from '../utils/cleanup.js';

// Mounted at /api/admin behind requireAdmin (see app.js). Registers devices,
// hands out their .env files and owner pairing QRs.
const router = Router();

const WOKWI_WIFI = { ssid: 'Wokwi-GUEST', password: '' };
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const wifiSchema = z.object({
  ssid: z
    .string()
    .min(1, 'is required')
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 32, 'must be at most 32 bytes'),
  // WPA2 passphrases are 8–63 characters; empty means an open network.
  password: z.string().refine((p) => p.length === 0 || (p.length >= 8 && p.length <= 63), {
    message: 'must be empty (open network) or 8–63 characters',
  }),
});

const createSchema = z
  .object({
    kind: z.enum(['hardware', 'simulator']),
    display: z.enum(['sh1106', 'ssd1306']),
    wifi: wifiSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'hardware' && !body.wifi) {
      ctx.addIssue({ code: 'custom', path: ['wifi'], message: 'is required for hardware devices' });
    }
    // Wokwi only has an SSD1306 part (docs/plan/phase-1-foundation.md §B2).
    if (body.kind === 'simulator' && body.display !== 'ssd1306') {
      ctx.addIssue({
        code: 'custom',
        path: ['display'],
        message: 'must be ssd1306 for simulators',
      });
    }
  });

const updateSchema = z.object({ wifi: wifiSchema });

// ---- Helpers ----------------------------------------------------------------

async function findDevice(id, select = '') {
  const device = await Device.findById(id).select(select);
  if (!device) throw new HttpError(404, 'device_not_found', 'No such device');
  return device;
}

function envFileFor(device, secret, config) {
  return buildEnvFile({
    deviceId: device._id,
    secret,
    brokerUrl: config.publicMqttUrl,
    wifiSsid: device.wifi.ssid,
    wifiPassword: device.wifi.password ? decrypt(device.wifi.password, config.secretsKey) : '',
  });
}

// Random IDs like "oled-7k2m9q"; retried in the (unlikely) case of a clash.
async function createWithUniqueId(fields) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Device.create({ _id: `oled-${randomString(ID_ALPHABET, 6)}`, ...fields });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new HttpError(500, 'id_exhausted', 'Could not generate a unique device ID');
}

// ---- Routes -----------------------------------------------------------------

router.get('/devices', async (req, res) => {
  const devices = await Device.find().sort({ createdAt: -1 }).populate('members.user', 'name');
  res.json({ devices });
});

router.post('/devices', validateBody(createSchema), async (req, res) => {
  const { config } = req.app.locals;
  const { kind, display } = req.body;
  const wifi = kind === 'simulator' ? WOKWI_WIFI : req.body.wifi;
  const secret = randomToken();

  const device = await createWithUniqueId({
    kind,
    display,
    secret: encrypt(secret, config.secretsKey),
    wifi: {
      ssid: wifi.ssid,
      password: wifi.password ? encrypt(wifi.password, config.secretsKey) : undefined,
    },
  });
  // Mosquitto step: createClient for the device here; roll back on failure.
  await DeviceEvent.record(device._id, 'created', { kind, display });

  res.status(201).json({ device, envFile: envFileFor(device, secret, config) });
});

router.get('/devices/:id', async (req, res) => {
  const device = await Device.findById(req.params.id).populate('members.user', 'name');
  if (!device) throw new HttpError(404, 'device_not_found', 'No such device');
  const events = await DeviceEvent.find({ device: device._id }).sort({ at: -1 }).limit(50);
  res.json({ device, events });
});

router.patch('/devices/:id', validateBody(updateSchema), async (req, res) => {
  const { config } = req.app.locals;
  const device = await findDevice(req.params.id);
  const { ssid, password } = req.body.wifi;

  device.wifi.ssid = ssid;
  device.wifi.password = password ? encrypt(password, config.secretsKey) : undefined;
  await device.save();
  await DeviceEvent.record(device._id, 'wifi_changed', { ssid });

  res.json({ device, rebuildRequired: true });
});

router.delete('/devices/:id', async (req, res) => {
  const device = await findDevice(req.params.id);
  // Mosquitto step: deleteClient (disconnects the device) before deleting.
  await Promise.all([
    Device.deleteOne({ _id: device._id }),
    PairingCode.deleteMany({ device: device._id }),
    DeviceEvent.deleteMany({ device: device._id }),
  ]);
  res.status(204).end();
});

router.post('/devices/:id/rotate-secret', async (req, res) => {
  const { config } = req.app.locals;
  const device = await findDevice(req.params.id, '+wifi.password');
  const secret = randomToken();

  device.secret = encrypt(secret, config.secretsKey);
  device.secretVersion += 1;
  await device.save();
  // Mosquitto step: deleteClient + createClient with the new secret.
  await DeviceEvent.record(device._id, 'rotate', { secretVersion: device.secretVersion });

  res.json({ device, envFile: envFileFor(device, secret, config), rebuildRequired: true });
});

// The complete .env file as a download, e.g. after losing the local copy.
router.get('/devices/:id/env', async (req, res) => {
  const { config } = req.app.locals;
  const device = await findDevice(req.params.id, '+secret +wifi.password');
  const secret = decrypt(device.secret, config.secretsKey);

  res
    .type('text/plain')
    .set('Content-Disposition', `attachment; filename="${device._id}.env"`)
    .set('Cache-Control', 'no-store')
    .send(envFileFor(device, secret, config));
});

// QR for the first phone (or to replace a lost owner phone).
router.post('/devices/:id/pairing-codes', async (req, res) => {
  const device = await findDevice(req.params.id);
  const pairing = await createPairingCode({
    deviceId: device._id,
    role: 'owner',
    createdBy: { kind: 'admin' },
    frontendUrl: req.app.locals.config.frontendUrl,
  });
  res.status(201).json(pairing);
});

// Runs the nightly cleanup now, for testing.
router.post('/cleanup', async (req, res) => {
  const summary = await runCleanup({ logger: req.app.locals.logger, reason: 'manual (admin)' });
  res.json(summary);
});

export default router;
