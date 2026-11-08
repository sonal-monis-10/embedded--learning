import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { optionalSession, requireSession } from '../middleware/auth.js';
import { HttpError, badRequest } from '../middleware/errors.js';
import { pairingLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { withdrawPairing } from '../utils/pairingIssuer.js';
import { release } from '../utils/turns.js';

// Mounted at /api. Pairing a phone with the device whose QR it scanned (no
// email or password), and the phone's own profile.

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
  // One message for wrong, used and expired codes, so guessing teaches nothing.
  if (!pairing) {
    throw badRequest(
      'invalid_code',
      'This code has run out or was already used. Use the new one on the screen.',
    );
  }

  const { user, sessionToken, expiresAt } = await pairingUser(req);

  // One phone, one device: leave whatever this phone controlled before.
  const previous = await Device.controlledBy(user._id);
  if (previous && previous._id !== pairing.device) await release(previous._id, 'switched');

  const device =
    previous?._id === pairing.device ? previous : await Device.claim(pairing.device, user._id);
  if (!device) {
    throw new HttpError(
      409,
      'device_taken',
      'Someone else just took this screen. Wait for a new code.',
    );
  }

  if (!device.name) {
    device.name = `${user.name}'s screen`.slice(0, 40);
    await device.save();
  }
  await withdrawPairing(device._id);
  await DeviceEvent.record(device._id, 'paired', { name: user.name });

  res.json({ sessionToken, expiresAt, user, device: device.toPhoneJSON() });
}

async function getMe(req, res) {
  const device = await Device.controlledBy(req.user._id);
  res.json({
    user: req.user,
    expiresAt: req.session.expiresAt,
    device: device?.toPhoneJSON() ?? null,
  });
}

async function renameMe(req, res) {
  req.user.name = req.body.name;
  await req.user.save();
  res.json({ user: req.user });
}

async function logout(req, res) {
  const device = await Device.controlledBy(req.user._id);
  if (device) await release(device._id, 'logout');
  await req.session.deleteOne();
  res.status(204).end();
}

// A phone that already paired today keeps its user and session. A new
// phone gets a user and a session token.
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
