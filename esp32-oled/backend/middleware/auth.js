import { config } from '../utils/config.js';
import { sameSecret } from '../utils/secrets.js';
import { Session } from '../entity/session.js';
import { Device } from '../entity/device.js';
import { forbidden, notFound, unauthorized } from './errors.js';

export function requireAdmin(req, _res, next) {
  if (!sameSecret(req.get('x-admin-key') ?? '', config.adminKey)) {
    throw unauthorized('invalid_admin_key', 'Missing or wrong X-Admin-Key header');
  }
  next();
}

export async function requireSession(req, _res, next) {
  if (!(await attachSession(req))) {
    throw unauthorized(
      'session_required',
      'Scan a pairing QR to continue. Sessions end at midnight.',
    );
  }
  next();
}

// For routes that work with or without a session, like POST /api/pair.
export async function optionalSession(req, _res, next) {
  await attachSession(req);
  next();
}

// Loads :id into req.device and the caller's role into req.role. A device
// the caller isn't on is "not found", so strangers can't probe device IDs.
export const requireMember = deviceAccess({ ownerOnly: false });
export const requireOwner = deviceAccess({ ownerOnly: true });

function deviceAccess({ ownerOnly }) {
  return async (req, _res, next) => {
    const device = await Device.findOne({ _id: req.params.id, 'members.user': req.user._id });
    if (!device) throw notFound('device_not_found', 'No such device');

    const role = device.roleOf(req.user._id);
    if (ownerOnly && role !== 'owner') {
      throw forbidden('owner_only', 'Only the device owner can do this');
    }

    req.device = device;
    req.role = role;
    next();
  };
}

// Sets req.session and req.user from "Authorization: Bearer <token>".
async function attachSession(req) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!token) return false;

  const session = await Session.findActive(token);
  if (!session?.user) return false;

  req.session = session;
  req.user = session.user;
  return true;
}
