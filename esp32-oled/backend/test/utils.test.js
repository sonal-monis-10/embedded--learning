import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  decrypt,
  encrypt,
  normalizePairingCode,
  PAIRING_ALPHABET,
  randomPairingCode,
  safeEqual,
} from '../utils/crypto.js';
import { dateIn, nextMidnight } from '../utils/time.js';
import { buildEnvFile } from '../utils/envFile.js';

describe('encrypt / decrypt', () => {
  const key = crypto.randomBytes(32);

  it('round-trips, with a different IV every time', () => {
    const a = encrypt('s3cret', key);
    const b = encrypt('s3cret', key);
    assert.notEqual(a.data, b.data);
    assert.equal(decrypt(a, key), 's3cret');
  });

  it('fails with the wrong key or tampered data', () => {
    const box = encrypt('s3cret', key);
    assert.throws(() => decrypt(box, crypto.randomBytes(32)));
    const tampered = { ...box, data: Buffer.from('x' + box.data).toString('base64') };
    assert.throws(() => decrypt(tampered, key));
  });
});

describe('pairing codes', () => {
  it('uses only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomPairingCode();
      assert.equal(code.length, 8);
      assert.ok(
        [...code].every((c) => PAIRING_ALPHABET.includes(c)),
        code,
      );
    }
    assert.ok(!/[01ILO]/.test(PAIRING_ALPHABET));
  });

  it('normalizes typed input', () => {
    assert.equal(normalizePairingCode(' k3f9-qxw2 '), 'K3F9QXW2');
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('time zones', () => {
  const tz = 'Asia/Kolkata';

  it('dateIn switches at local midnight', () => {
    // 18:29 UTC = 23:59 IST, 18:30 UTC = 00:00 IST the next day.
    assert.equal(dateIn(tz, new Date('2026-11-01T18:29:00Z')), '2026-11-01');
    assert.equal(dateIn(tz, new Date('2026-11-01T18:30:00Z')), '2026-11-02');
  });

  it('nextMidnight is the next 00:00 IST', () => {
    const at = (iso) => nextMidnight(tz, new Date(iso)).toISOString();
    assert.equal(at('2026-11-01T10:00:00Z'), '2026-11-01T18:30:00.000Z');
    assert.equal(at('2026-11-01T18:30:00Z'), '2026-11-02T18:30:00.000Z');
    // Month and year rollover.
    assert.equal(at('2026-12-31T12:00:00Z'), '2026-12-31T18:30:00.000Z');
  });

  it('works for other zones', () => {
    assert.equal(
      nextMidnight('UTC', new Date('2026-11-01T10:00:00Z')).toISOString(),
      '2026-11-02T00:00:00.000Z',
    );
  });
});

describe('buildEnvFile', () => {
  it('quotes values so special characters survive', () => {
    const text = buildEnvFile({
      deviceId: 'oled-abc123',
      secret: 'S',
      brokerUrl: 'wss://x/mqtt',
      wifiSsid: 'My "Home" #2',
      wifiPassword: 'pa ss\\word',
    });
    const values = Object.fromEntries(
      text
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), JSON.parse(line.slice(i + 1))];
        }),
    );
    assert.deepEqual(values, {
      DEVICE_ID: 'oled-abc123',
      DEVICE_SECRET: 'S',
      BROKER_URL: 'wss://x/mqtt',
      WIFI_SSID: 'My "Home" #2',
      WIFI_PASS: 'pa ss\\word',
    });
  });
});
