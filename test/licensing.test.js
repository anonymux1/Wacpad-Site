import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateLicenseKey, verifyLicenseKey, DEFAULT_LICENSE_SECRET } from '../lib/licensing.js';

describe('License Key Generation', () => {
  it('1. Generate ProLifetime key starts with WP1-', () => {
    const key = generateLicenseKey('artist@wacpad.io', 'ProLifetime');
    assert.ok(key.startsWith('WP1-'), `Key must start with WP1-, got: ${key}`);
  });

  it('2. Generate ProAnnual key starts with WP1-', () => {
    const key = generateLicenseKey('artist@wacpad.io', 'ProAnnual');
    assert.ok(key.startsWith('WP1-'), `Key must start with WP1-, got: ${key}`);
  });

  it('3. Generated key verifies successfully', () => {
    const key = generateLicenseKey('creator@wacpad.io', 'ProLifetime');
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.ok(result.payload, 'Verification result should contain payload');
  });

  it('4. Payload contains correct email (trimmed, lowercased)', () => {
    const key = generateLicenseKey('  Artist@WacPad.IO  ', 'ProLifetime');
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'artist@wacpad.io');
  });

  it('5. Payload contains correct tier', () => {
    const lifetimeKey = generateLicenseKey('user@test.com', 'ProLifetime');
    const lifetimeRes = verifyLicenseKey(lifetimeKey);
    assert.equal(lifetimeRes.payload.tier, 'ProLifetime');

    const annualKey = generateLicenseKey('user@test.com', 'ProAnnual');
    const annualRes = verifyLicenseKey(annualKey);
    assert.equal(annualRes.payload.tier, 'ProAnnual');
  });

  it('6. Payload contains correct issued_at timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const key = generateLicenseKey('user@test.com', 'ProLifetime');
    const after = Math.floor(Date.now() / 1000);

    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.ok(
      result.payload.issued_at >= before && result.payload.issued_at <= after,
      `issued_at (${result.payload.issued_at}) should be between ${before} and ${after}`
    );
  });

  it('7. Payload expires_at is null when not specified', () => {
    const key = generateLicenseKey('user@test.com', 'ProLifetime');
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.strictEqual(result.payload.expires_at, null);
  });

  it('8. Email case normalization: Artist@Domain.COM -> artist@domain.com', () => {
    const key = generateLicenseKey('Artist@Domain.COM', 'ProLifetime');
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'artist@domain.com');
  });

  it('9. Email whitespace trimming:  user@test.com  -> user@test.com', () => {
    const key = generateLicenseKey('   user@test.com   ', 'ProLifetime');
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'user@test.com');
  });

  it('19. Deterministic: same email + tier + issuedAt -> same key', () => {
    const timestamp = 1700000000;
    const key1 = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, timestamp);
    const key2 = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, timestamp);
    assert.equal(key1, key2, 'Keys generated with identical parameters must be identical');
  });

  it('20. Different emails -> different keys', () => {
    const timestamp = 1700000000;
    const key1 = generateLicenseKey('alice@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, timestamp);
    const key2 = generateLicenseKey('bob@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, timestamp);
    assert.notEqual(key1, key2);
  });

  it('21. Different issuedAt -> different keys', () => {
    const key1 = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, 1700000000);
    const key2 = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, 1700000001);
    assert.notEqual(key1, key2);
  });

  it('24. Non-string email (null) does not crash (coerced via String())', () => {
    assert.doesNotThrow(() => {
      const key = generateLicenseKey(null, 'ProLifetime');
      assert.ok(key.startsWith('WP1-'));
      const result = verifyLicenseKey(key);
      assert.equal(result.valid, true);
      assert.equal(result.payload.email, 'null');
    });
  });

  it('25. undefined expiresAt coerced to null', () => {
    const key = generateLicenseKey('user@test.com', 'ProLifetime', undefined);
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.strictEqual(result.payload.expires_at, null);
  });
});

describe('License Key Verification', () => {
  it('10. Tampered key rejected (modify last 3 chars)', () => {
    const key = generateLicenseKey('tamper@test.com', 'ProLifetime');
    const tampered = key.slice(0, -3) + 'XYZ';
    const result = verifyLicenseKey(tampered);
    assert.equal(result.valid, false);
    assert.match(result.error, /signature/i);
  });

  it('11. Tampered key rejected (bit flip in middle of Base64)', () => {
    const key = generateLicenseKey('bitflip@test.com', 'ProLifetime');
    const prefix = 'WP1-';
    const b64 = key.slice(prefix.length);
    const midIdx = Math.floor(b64.length / 2);
    const flippedChar = b64[midIdx] === 'A' ? 'B' : 'A';
    const tampered = prefix + b64.slice(0, midIdx) + flippedChar + b64.slice(midIdx + 1);

    const result = verifyLicenseKey(tampered);
    assert.equal(result.valid, false);
  });

  it('12. Empty string key rejected', () => {
    const result = verifyLicenseKey('');
    assert.equal(result.valid, false);
    assert.match(result.error, /prefix/i);

    const nullResult = verifyLicenseKey(null);
    assert.equal(nullResult.valid, false);

    const undefinedResult = verifyLicenseKey(undefined);
    assert.equal(undefinedResult.valid, false);
  });

  it('13. WP2-... prefix rejected', () => {
    const result = verifyLicenseKey('WP2-eyJlbWFpbCI6ImFydGlzdEB3YWNwYWQuaW8ifQ==');
    assert.equal(result.valid, false);
    assert.match(result.error, /prefix/i);
  });

  it('14. Key without any prefix rejected', () => {
    const result = verifyLicenseKey('eyJlbWFpbCI6ImFydGlzdEB3YWNwYWQuaW8ifQ==');
    assert.equal(result.valid, false);
    assert.match(result.error, /prefix/i);
  });

  it('15. Very short Base64 payload rejected (< 32 bytes decoded)', () => {
    // "dG9vX3Nob3J0" decodes to "too_short" which is 9 bytes (< 32 bytes signature requirement)
    const result = verifyLicenseKey('WP1-dG9vX3Nob3J0');
    assert.equal(result.valid, false);
    assert.match(result.error, /too short/i);
  });

  it('16. Expired key rejected (expires_at = 1000000000, way in the past)', () => {
    const expiredTimestamp = 1000000000; // Sept 2001
    const key = generateLicenseKey('expired@test.com', 'ProAnnual', expiredTimestamp);
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, false);
    assert.match(result.error, /expired/i);
    assert.ok(result.payload, 'Expired key result should still include decoded payload');
    assert.equal(result.payload.expires_at, expiredTimestamp);
  });

  it('17. Valid key with future expires_at accepted (expires_at = 9999999999)', () => {
    const futureTimestamp = 9999999999;
    const key = generateLicenseKey('future@test.com', 'ProAnnual', futureTimestamp);
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.payload.expires_at, futureTimestamp);
  });

  it('18. null expires_at accepted (no expiration)', () => {
    const key = generateLicenseKey('lifetime@test.com', 'ProLifetime', null);
    const result = verifyLicenseKey(key);
    assert.equal(result.valid, true);
    assert.strictEqual(result.payload.expires_at, null);
  });

  it('22. Custom secret: generate with custom secret, verify with same -> valid', () => {
    const customSecret = 'my-super-secret-custom-key-12345';
    const key = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, customSecret);
    const result = verifyLicenseKey(key, customSecret);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'artist@wacpad.io');
  });

  it('23. Mismatched secret: generate with one, verify with another -> invalid', () => {
    const secretA = 'secret-alpha-1111';
    const secretB = 'secret-beta-2222';
    const key = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, secretA);
    const result = verifyLicenseKey(key, secretB);
    assert.equal(result.valid, false);
    assert.match(result.error, /signature/i);
  });

  it('27. Key with surrounding whitespace is accepted after trimming', () => {
    const key = generateLicenseKey('artist@wacpad.io', 'ProLifetime');
    const paddedKey = `  \n\t  ${key}  \r\n  `;
    const result = verifyLicenseKey(paddedKey);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'artist@wacpad.io');
  });

  it('28. Corrupt payload JSON with valid HMAC is rejected', () => {
    const nonJsonPayload = Buffer.from('this is not json at all!', 'utf8');
    const hmac = crypto.createHmac('sha256', Buffer.from(DEFAULT_LICENSE_SECRET, 'utf8'));
    hmac.update(nonJsonPayload);
    const sig = hmac.digest();
    const combined = Buffer.concat([nonJsonPayload, sig]);
    const malformedKey = `WP1-${combined.toString('base64')}`;

    const result = verifyLicenseKey(malformedKey);
    assert.equal(result.valid, false);
    assert.match(result.error, /corrupt payload json/i);
  });
});

describe('Cross-Platform Compatibility', () => {
  it('26. Hardcoded JS-generated key validates against default secret (matches Rust test key)', () => {
    // Key used in crates/wacpad-core/tests/test_licensing.rs
    const rustTestKey = 'WP1-eyJlbWFpbCI6ImFydGlzdEB3YWNwYWQuaW8iLCJ0aWVyIjoiUHJvTGlmZXRpbWUiLCJpc3N1ZWRfYXQiOjE3ODk0NTE1NzIsImV4cGlyZXNfYXQiOm51bGx9aPMxcbNV/oqw0qCl+rF8cx3klbxFLWPyRkUTUAKlF74=';
    const result = verifyLicenseKey(rustTestKey);
    assert.equal(result.valid, true);
    assert.equal(result.payload.email, 'artist@wacpad.io');
    assert.equal(result.payload.tier, 'ProLifetime');
    assert.equal(result.payload.issued_at, 1789451572);
    assert.strictEqual(result.payload.expires_at, null);
  });

  it('29. JavaScript generator reproduces exact Rust test key when given identical parameters', () => {
    const generated = generateLicenseKey(
      'artist@wacpad.io',
      'ProLifetime',
      null,
      DEFAULT_LICENSE_SECRET,
      1789451572
    );
    const expected = 'WP1-eyJlbWFpbCI6ImFydGlzdEB3YWNwYWQuaW8iLCJ0aWVyIjoiUHJvTGlmZXRpbWUiLCJpc3N1ZWRfYXQiOjE3ODk0NTE1NzIsImV4cGlyZXNfYXQiOm51bGx9aPMxcbNV/oqw0qCl+rF8cx3klbxFLWPyRkUTUAKlF74=';
    assert.equal(generated, expected, 'JS output must match Rust test key bit-for-bit');
  });

  it('30. Key payload JSON structure matches Rust serde_json format without whitespace', () => {
    const key = generateLicenseKey('artist@wacpad.io', 'ProLifetime', null, DEFAULT_LICENSE_SECRET, 1789451572);
    const b64 = key.slice(4);
    const buf = Buffer.from(b64, 'base64');
    const jsonBytes = buf.subarray(0, buf.length - 32);
    const jsonStr = jsonBytes.toString('utf8');
    assert.equal(
      jsonStr,
      '{"email":"artist@wacpad.io","tier":"ProLifetime","issued_at":1789451572,"expires_at":null}'
    );
  });
});
