import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { optionalSession, requireSession } from '../middleware/auth.js';
import { pairingLimiter } from '../middleware/rateLimit.js';
import { Device } from '../entity/device.js';
import { DeviceEvent } from '../entity/deviceEvent.js';
import { PairingCode } from '../entity/pairingCode.js';
import { Session } from '../entity/session.js';
import { User } from '../entity/user.js';
import { normalizePairingCode, randomToken, sha256 } from '../utils/crypto.js';
import { nextMidnight } from '../utils/time.js';

// Mounted at /api. Turns a scanned pairing QR into a session (no email or
// password), plus the current user's own profile and logout.
const router = Router();

const nameSchema = z.string().trim().min(1, 'is required').max(40);
const pairSchema = z.object({ code: z.string().min(1, 'is required').max(32), name: nameSchema });

// Same message for wrong, used and expired codes, so a guesser learns nothing.
const invalidCode = () =>
  new HttpError(
    400,
    'invalid_code',
    'This pairing code is wrong, used or expired. Ask for a new QR.',
  );

router.post(
  '/pair',
  pairingLimiter,
  optionalSession,
  validateBody(pairSchema),
  async (req, res) => {
    const { config } = req.app.locals;
    const { name } = req.body;
    const now = new Date();

    // Redeem atomically: two phones scanning the same QR can't both win.
    const pairing = await PairingCode.findOneAndUpdate(
      {
        codeHash: sha256(normalizePairingCode(req.body.code)),
        usedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { returnDocument: 'after' },
    );
    if (!pairing) throw invalidCode();
    const device = await Device.findById(pairing.device);
    if (!device) throw invalidCode();

    // A phone that already paired today keeps its user and session; a new
    // phone gets both. The token is returned only when it is new.
    let user = req.user;
    let sessionToken = null;
    let expiresAt = req.session?.expiresAt;
    if (user) {
      user.name = name;
      user.lastSeenAt = now;
      await user.save();
    } else {
      user = await User.create({ name, lastSeenAt: now });
      sessionToken = randomToken();
      expiresAt = nextMidnight(config.cleanupTz, now);
      await Session.create({
        user: user._id,
        tokenHash: sha256(sessionToken),
        userAgent: (req.get('user-agent') ?? '').slice(0, 300),
        expiresAt,
      });
    }

    if (pairing.role === 'owner') {
      // An owner code replaces the current owner (e.g. their phone was lost).
      device.members = device.members.filter((m) => m.role !== 'owner' && !m.user.equals(user._id));
      device.members.push({ user: user._id, role: 'owner' });
      if (!device.name) device.name = `${name}'s OLED`.slice(0, 40);
    } else if (!device.roleOf(user._id)) {
      device.members.push({ user: user._id, role: 'member' });
    }
    await device.save();
    // Mosquitto step: add this device's ACLs to the user's role.

    const role = device.roleOf(user._id);
    await DeviceEvent.record(device._id, 'paired', { role, name });

    res.json({ sessionToken, expiresAt, user, device: device.forUser(user._id) });
  },
);

router.get('/me', requireSession, async (req, res) => {
  const devices = await Device.find({ 'members.user': req.user._id }).sort({ name: 1 });
  res.json({
    user: req.user,
    expiresAt: req.session.expiresAt,
    devices: devices.map((d) => d.forUser(req.user._id)),
  });
});

router.patch(
  '/me',
  requireSession,
  validateBody(z.object({ name: nameSchema })),
  async (req, res) => {
    req.user.name = req.body.name;
    await req.user.save();
    res.json({ user: req.user });
  },
);

router.post('/logout', requireSession, async (req, res) => {
  await Session.deleteOne({ _id: req.session._id });
  // Mosquitto step: deleteClient s-<sessionId>.
  res.status(204).end();
});

export default router;
