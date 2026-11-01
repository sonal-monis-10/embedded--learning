import { PairingCode, PAIRING_CODE_TTL_MS } from '../entity/pairingCode.js';
import { randomPairingCode, sha256 } from './crypto.js';

// Creates a one-time pairing code for a device and returns the link that
// goes into the QR. Used by the admin page (role 'owner') and by an owner's
// "Add phone" button (role 'member').
export async function createPairingCode({ deviceId, role, createdBy, frontendUrl }) {
  const code = randomPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

  await PairingCode.create({
    codeHash: sha256(code),
    device: deviceId,
    role,
    createdBy,
    expiresAt,
  });

  return { code, url: `${frontendUrl}/pair/${code}`, role, expiresAt };
}
