import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { requireMember, requireOwner } from '../middleware/auth.js';
import { forbidden, notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

// Mounted at /api/devices behind requireSession: what a paired phone can do
// with the devices it is on.

const renameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const modeSchema = z.object({ mode: z.enum(['idle', 'eyes', 'music']) });

const router = Router();

router.get('/', listMyDevices);
router.get('/:id', requireMember, getDevice);
router.patch('/:id', requireOwner, validate(renameSchema), renameDevice);
router.post('/:id/pairing-codes', requireOwner, createMemberPairingCode);
router.delete('/:id/members/:userId', requireMember, removeMember);
router.put('/:id/mode', requireMember, validate(modeSchema), setMode);

export default router;

async function listMyDevices(req, res) {
  const devices = await Device.find({ 'members.user': req.user._id }).sort({ name: 1 });
  res.json({ devices: devices.map((device) => device.toPhoneJSON(req.user._id)) });
}

async function getDevice(req, res) {
  const { device, user } = req;
  await device.populate('members.user', 'name');

  res.json({
    device: device.toPhoneJSON(user._id),
    members: device.members.map((m) => ({
      id: m.user._id,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  });
}

async function renameDevice(req, res) {
  req.device.name = req.body.name;
  await req.device.save();
  res.json({ device: req.device.toPhoneJSON(req.user._id) });
}

// "Add phone": a QR on the owner's screen; whoever scans it becomes a member.
async function createMemberPairingCode(req, res) {
  const pairing = await PairingCode.issue({
    device: req.device._id,
    role: 'member',
    createdBy: { kind: 'user', user: req.user._id },
  });
  res.status(201).json(pairing);
}

// The owner can remove anyone; members can only remove themselves.
async function removeMember(req, res) {
  const { device, user, role } = req;
  const { userId } = req.params;
  const removingSelf = user._id.equals(userId);

  if (role !== 'owner' && !removingSelf) {
    throw forbidden('owner_only', 'Only the device owner can remove other phones');
  }
  if (!mongoose.isValidObjectId(userId) || !device.removeMember(userId)) {
    throw notFound('member_not_found', 'No such member');
  }

  await device.save();
  // TODO(mqtt): take this device out of the user's MQTT role.
  await DeviceEvent.record(device._id, 'member_removed', { userId, removingSelf });

  res.status(204).end();
}

async function setMode(req, res) {
  req.device.mode = req.body.mode;
  await req.device.save();
  // TODO(mqtt): publish the mode (retained) so the device switches.
  res.json({ mode: req.device.mode });
}
