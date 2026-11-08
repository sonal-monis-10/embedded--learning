import { config } from '../utils/config.js';
import { sameSecret } from '../utils/secrets.js';
import { Session } from '../entity/session.js';
import { Device } from '../entity/device.js';
import { notFound, unauthorized } from './errors.js';

// Firmware registering itself on first boot (POST /api/admin/devices).
export function requireProvisionKey(req, _res, next) {
  if (!sameSecret(req.get('x-provision-key') ?? '', config.provisionKey)) {
    throw unauthorized('invalid_provision_key', 'Missing or wrong X-Provision-Key header');
  }
  next();
}

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

// Loads :id into req.device if the caller controls it. Any other device is
// "not found", so a phone can't even probe which device IDs exist.
export async function requireController(req, _res, next) {
  const device = await Device.findOne({ _id: req.params.id, 'controller.user': req.user._id });
  if (!device) throw notFound('device_not_found', 'This screen is not yours right now');
  req.device = device;
  next();
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
