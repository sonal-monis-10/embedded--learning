import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requireDeviceRole } from '../middleware/auth.js';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { createPairingCode } from '../utils/pairing.js';

// Mounted at /api/devices behind requireSession (see app.js). Everything a
// paired phone can do with the devices it is a member of.
const router = Router();

const member = requireDeviceRole('member');
const owner = requireDeviceRole('owner');

router.get('/', async (req, res) => {
  const devices = await Device.find({ 'members.user': req.user._id }).sort({ name: 1 });
  res.json({ devices: devices.map((d) => d.forUser(req.user._id)) });
});

router.get('/:id', member, async (req, res) => {
  await req.device.populate('members.user', 'name');
  res.json({
    device: req.device.forUser(req.user._id),
    members: req.device.members.map((m) => ({
      id: m.user._id,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  });
});

router.patch(
  '/:id',
  owner,
  validateBody(z.object({ name: z.string().trim().min(1).max(40) })),
  async (req, res) => {
    req.device.name = req.body.name;
    await req.device.save();
    res.json({ device: req.device.forUser(req.user._id) });
  },
);

// "Add phone": a QR on the owner's screen that makes the scanner a member.
router.post('/:id/pairing-codes', owner, async (req, res) => {
  const pairing = await createPairingCode({
    deviceId: req.device._id,
    role: 'member',
    createdBy: { kind: 'user', user: req.user._id },
    frontendUrl: req.app.locals.config.frontendUrl,
  });
  res.status(201).json(pairing);
});

// The owner can remove anyone; a member can only remove themselves (leave).
router.delete('/:id/members/:userId', member, async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    throw new HttpError(404, 'member_not_found', 'No such member');
  }

  const isSelf = req.user._id.equals(userId);
  if (req.role !== 'owner' && !isSelf) {
    throw new HttpError(403, 'owner_only', 'Only the device owner can remove other phones');
  }

  const before = req.device.members.length;
  req.device.members = req.device.members.filter((m) => !m.user.equals(userId));
  if (req.device.members.length === before) {
    throw new HttpError(404, 'member_not_found', 'No such member');
  }
  await req.device.save();
  // Mosquitto step: remove this device's ACLs from that user's role.
  await DeviceEvent.record(req.device._id, 'member_removed', { userId, bySelf: isSelf });

  res.status(204).end();
});

router.put(
  '/:id/mode',
  member,
  validateBody(z.object({ mode: z.enum(['idle', 'eyes', 'music']) })),
  async (req, res) => {
    req.device.mode = req.body.mode;
    await req.device.save();
    // Mosquitto step: publish retained d/<id>/mode.
    res.json({ mode: req.device.mode });
  },
);

export default router;
