import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { optionalSession, requireSession } from '../middleware/auth.js';
import { badRequest } from '../middleware/errors.js';
import { pairingLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

// Mounted at /api. Pairing a phone by QR (no email or password), and the
// phone's own profile.

const nameSchema = z.string().trim().min(1, 'is required').max(40);
const pairSchema = z.object({ code: z.string().min(1, 'is required').max(32), name: nameSchema });
const renameSchema = z.object({ name: nameSchema });

const router = Router();

router.post('/pair', pairingLimiter, optionalSession, validate(pairSchema), pair);
router.get('/me', requireSession, getMe);
router.patch('/me', requireSession, validate(renameSchema), renameMe);
router.post('/logout', requireSession, logout);

export default router;

async function pair(req, res) {
  const pairing = await PairingCode.redeem(req.body.code);
  const device = pairing && (await Device.findById(pairing.device));
  // One message for wrong, used and expired codes, so guessing teaches nothing.
  if (!device) {
    throw badRequest(
      'invalid_code',
      'This pairing code is wrong, used or expired. Ask for a new QR.',
    );
  }

  const { user, sessionToken, expiresAt } = await pairingUser(req);

  device.addMember(user._id, pairing.role);
  if (pairing.role === 'owner' && !device.name) {
    device.name = `${user.name}'s OLED`.slice(0, 40);
  }
  await device.save();
  // TODO(mqtt): give the user's MQTT role access to this device.
  await DeviceEvent.record(device._id, 'paired', {
    role: device.roleOf(user._id),
    name: user.name,
  });

  res.json({ sessionToken, expiresAt, user, device: device.toPhoneJSON(user._id) });
}

async function getMe(req, res) {
  const devices = await Device.find({ 'members.user': req.user._id }).sort({ name: 1 });
  res.json({
    user: req.user,
    expiresAt: req.session.expiresAt,
    devices: devices.map((device) => device.toPhoneJSON(req.user._id)),
  });
}

async function renameMe(req, res) {
  req.user.name = req.body.name;
  await req.user.save();
  res.json({ user: req.user });
}

async function logout(req, res) {
  await req.session.deleteOne();
  // TODO(mqtt): delete this session's MQTT login.
  res.status(204).end();
}

// A phone that already paired today keeps its user and session, so one phone
// can control several devices. A new phone gets a user and a session token.
async function pairingUser(req) {
  const { name } = req.body;

  if (req.user) {
    req.user.set({ name, lastSeenAt: new Date() });
    await req.user.save();
    return { user: req.user, sessionToken: null, expiresAt: req.session.expiresAt };
  }

  const user = await User.create({ name, lastSeenAt: new Date() });
  const { token, session } = await Session.start(user, req.get('user-agent'));
  return { user, sessionToken: token, expiresAt: session.expiresAt };
}
