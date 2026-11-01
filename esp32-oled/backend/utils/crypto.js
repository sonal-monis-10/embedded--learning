import crypto from 'node:crypto';

// ---- Reversible encryption for secrets stored in MongoDB -------------------
// AES-256-GCM: confidentiality plus a tag that detects any tampering. A fresh
// random IV per value means equal secrets never look equal in the database.

export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt({ iv, tag, data }, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

// ---- Random values and one-way hashes --------------------------------------

// 32 random bytes = 43 URL-safe characters. Used for device secrets and
// session tokens.
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// For high-entropy random values (tokens, codes) a plain SHA-256 is enough;
// slow hashes like scrypt exist for human-chosen passwords.
export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Constant-time string comparison, so response timing reveals nothing about
// how many leading characters of a guess were right.
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Picks `length` characters uniformly from `alphabet` (randomInt avoids the
// bias of `byte % alphabet.length`).
export function randomString(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// Pairing codes: 31 symbols without look-alikes (no 0/O, 1/I/L), so a code
// can be typed by hand if the camera won't scan. 8 characters ≈ 8.5 × 10^11.
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;

export function randomPairingCode() {
  return randomString(PAIRING_ALPHABET, PAIRING_CODE_LENGTH);
}

// Users may type codes in lower case or with spaces/dashes.
export function normalizePairingCode(input) {
  return String(input).toUpperCase().replace(/[\s-]/g, '');
}
