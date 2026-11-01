import { HttpError } from './errors.js';
import { safeEqual, sha256 } from '../utils/crypto.js';
import { Session } from '../entity/session.js';
import { Device } from '../entity/device.js';

// ---- Admin ------------------------------------------------------------------

// /api/admin/* needs the X-Admin-Key header to equal ADMIN_KEY.
export function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key');
  if (!key || !safeEqual(key, req.app.locals.config.adminKey)) {
    throw new HttpError(401, 'invalid_admin_key', 'Missing or wrong X-Admin-Key header');
  }
  next();
}

// ---- Paired phones ----------------------------------------------------------

// Reads "Authorization: Bearer <token>" and returns the live session (with
// its user), or null. Expired sessions are rejected here even if MongoDB's
// TTL cleanup or the nightly cleanup hasn't deleted them yet.
async function findSession(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) return null;

  const now = new Date();
  const session = await Session.findOneAndUpdate(
    { tokenHash: sha256(match[1]), expiresAt: { $gt: now } },
    { $set: { lastUsedAt: now } },
    { returnDocument: 'after' },
  ).populate('user');
  return session?.user ? session : null;
}

// Attaches req.session / req.user when a valid token is sent, otherwise
// continues without them. Used by POST /api/pair, which works either way.
export async function optionalSession(req, res, next) {
  const session = await findSession(req);
  if (session) {
    req.session = session;
    req.user = session.user;
  }
  next();
}

export async function requireSession(req, res, next) {
  const session = await findSession(req);
  if (!session) {
    throw new HttpError(
      401,
      'session_required',
      'Scan a device pairing QR to continue (sessions end at midnight)',
    );
  }
  req.session = session;
  req.user = session.user;
  next();
}

// Loads :id as req.device if the current user is a member with at least
// `role`. A device the user isn't a member of is reported as not found, so
// strangers can't even confirm that a device ID exists.
export function requireDeviceRole(role) {
  return async (req, res, next) => {
    const device = await Device.findOne({ _id: req.params.id, 'members.user': req.user._id });
    if (!device) throw new HttpError(404, 'device_not_found', 'No such device');

    req.role = device.roleOf(req.user._id);
    if (role === 'owner' && req.role !== 'owner') {
      throw new HttpError(403, 'owner_only', 'Only the device owner can do this');
    }
    req.device = device;
    next();
  };
}
