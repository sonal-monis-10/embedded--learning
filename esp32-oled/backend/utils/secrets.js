import crypto from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM with a fresh IV per value. The auth tag makes any tampering
// with the stored value fail loudly on unseal().
export function seal(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.secretsKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function unseal({ iv, tag, data }) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    config.secretsKey,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

// 32 random bytes as 43 URL-safe characters.
export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Tokens and codes are random, so a fast hash is enough to store them safely.
// (Slow hashes like scrypt are for passwords people choose.)
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Constant-time comparison: response timing reveals nothing about a guess.
export function sameSecret(a, b) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest(),
  );
}

export function randomString(alphabet, length) {
  return Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}
