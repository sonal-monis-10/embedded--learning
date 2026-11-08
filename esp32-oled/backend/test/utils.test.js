import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameSecret, seal, unseal } from '../utils/secrets.js';
import { dateIn, nextMidnight } from '../utils/time.js';

describe('seal / unseal', () => {
  it('round-trips, with a different ciphertext every time', () => {
    const a = seal('s3cret');
    const b = seal('s3cret');
    assert.notEqual(a.data, b.data);
    assert.equal(unseal(a), 's3cret');
  });

  it('detects tampering', () => {
    const box = seal('s3cret');
    const tampered = { ...box, data: Buffer.from(`x${box.data}`).toString('base64') };
    assert.throws(() => unseal(tampered));
  });
});

describe('sameSecret', () => {
  it('compares strings of any length', () => {
    assert.equal(sameSecret('abc', 'abc'), true);
    assert.equal(sameSecret('abc', 'abcd'), false);
  });
});

describe('time zones', () => {
  const ist = 'Asia/Kolkata';
  const midnightAfter = (iso, tz = ist) => nextMidnight(tz, new Date(iso)).toISOString();

  it('dateIn changes at local midnight', () => {
    // 18:29 UTC is 23:59 IST; 18:30 UTC is 00:00 IST the next day.
    assert.equal(dateIn(ist, new Date('2026-11-01T18:29:00Z')), '2026-11-01');
    assert.equal(dateIn(ist, new Date('2026-11-01T18:30:00Z')), '2026-11-02');
  });

  it('nextMidnight is the next 00:00 IST', () => {
    assert.equal(midnightAfter('2026-11-01T10:00:00Z'), '2026-11-01T18:30:00.000Z');
    assert.equal(midnightAfter('2026-11-01T18:30:00Z'), '2026-11-02T18:30:00.000Z');
    assert.equal(midnightAfter('2026-12-31T12:00:00Z'), '2026-12-31T18:30:00.000Z');
  });

  it('works in other zones', () => {
    assert.equal(midnightAfter('2026-11-01T10:00:00Z', 'UTC'), '2026-11-02T00:00:00.000Z');
  });
});
