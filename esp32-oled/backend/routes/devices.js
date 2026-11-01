import { Router } from 'express';
import { z } from 'zod';
import { requireController } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publishCommand, publishMode } from '../mqtt/publisher.js';
import { recordActivity, release } from '../utils/turns.js';

// Mounted at /api/devices behind requireSession: what the phone can do with
// the one device it controls.

const renameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const modeSchema = z.object({ mode: z.enum(['idle', 'eyes', 'music']) });
const commandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('identify') }),
  z.object({ op: z.literal('reboot') }),
  z.object({ op: z.literal('brightness'), value: z.number().int().min(0).max(255) }),
]);

const router = Router();

router.get('/:id', requireController, getDevice);
router.patch('/:id', requireController, validate(renameSchema), renameDevice);
router.put('/:id/mode', requireController, validate(modeSchema), setMode);
router.post('/:id/leave', requireController, leave);
router.post('/:id/commands', requireController, validate(commandSchema), sendCommand);

export default router;

function getDevice(req, res) {
  res.json({ device: req.device.toPhoneJSON() });
}

async function renameDevice(req, res) {
  req.device.name = req.body.name;
  await req.device.save();
  res.json({ device: req.device.toPhoneJSON() });
}

async function setMode(req, res) {
  req.device.mode = req.body.mode;
  await req.device.save();
  await recordActivity(req.device._id);
  publishMode(req.device._id, req.device.mode);
  res.json({ mode: req.device.mode });
}

// Ends the turn; the OLED shows a fresh QR for the next visitor.
async function leave(req, res) {
  await release(req.device._id, 'left');
  res.status(204).end();
}

function sendCommand(req, res) {
  publishCommand(req.device._id, req.body);
  res.status(202).json({ sent: req.body.op });
}
