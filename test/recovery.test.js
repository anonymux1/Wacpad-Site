import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import lookupLicenseHandler from '../api/lookup-license.js';
import {
  saveLicenseMapping,
  getLicenseByEmail,
  getLicenseByCustomerId,
} from '../lib/db.js';
import { generateLicenseKey, verifyLicenseKey } from '../lib/licensing.js';
import { createMockReq, createMockRes, withEnvAsync } from './helpers.js';

// In-memory mock Redis client implementing required Upstash methods
class MockRedis {
  constructor() {
    this.store = new Map();
  }

  async set(key, value) {
    this.store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return 'OK';
  }

  async get(key) {
    return this.store.get(key) || null;
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }
}

describe('Upstash DB & License Recovery Flow', () => {
  let mockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
  });

  const testEmail = 'artist@wacpad.io';
  const testKey = generateLicenseKey(testEmail, 'ProLifetime', null, 1789559332);
  const testCustomerId = 'cus_test_1234567890';
  const testSessionId = 'cs_test_session_abcdef';

  // 1. saveLicenseMapping maps email to record in Upstash
  it('1. saveLicenseMapping stores license record mapped to normalized email', async () => {
    const res = await saveLicenseMapping(
      {
        email: '  Artist@WacPad.IO  ',
        licenseKey: testKey,
        customerId: testCustomerId,
        sessionId: testSessionId,
        tier: 'ProLifetime',
        createdAt: 1789559332,
      },
      mockRedis
    );

    assert.equal(res.success, true);
    assert.equal(res.record.email, testEmail);
    assert.equal(res.record.licenseKey, testKey);

    // Verify key in store
    const stored = await mockRedis.get(`license:by_email:${testEmail}`);
    assert.ok(stored, 'Record must exist in store');
    const parsed = JSON.parse(stored);
    assert.equal(parsed.licenseKey, testKey);
    assert.equal(parsed.customerId, testCustomerId);
    assert.equal(parsed.sessionId, testSessionId);
  });

  // 2. saveLicenseMapping also maps Stripe customerId to record
  it('2. saveLicenseMapping maps customerId to license record', async () => {
    await saveLicenseMapping(
      {
        email: testEmail,
        licenseKey: testKey,
        customerId: testCustomerId,
      },
      mockRedis
    );

    const record = await getLicenseByCustomerId(testCustomerId, mockRedis);
    assert.ok(record, 'Must find record by customerId');
    assert.equal(record.email, testEmail);
    assert.equal(record.licenseKey, testKey);
  });

  // 3. getLicenseByEmail handles case and whitespace normalization
  it('3. getLicenseByEmail retrieves record regardless of email casing or spacing', async () => {
    await saveLicenseMapping(
      {
        email: testEmail,
        licenseKey: testKey,
      },
      mockRedis
    );

    const r1 = await getLicenseByEmail('artist@wacpad.io', mockRedis);
    assert.equal(r1?.licenseKey, testKey);

    const r2 = await getLicenseByEmail('  ARTIST@WACPAD.IO  ', mockRedis);
    assert.equal(r2?.licenseKey, testKey);

    const r3 = await getLicenseByEmail('nonexistent@wacpad.io', mockRedis);
    assert.equal(r3, null);
  });

  // 4. saveLicenseMapping validation
  it('4. saveLicenseMapping rejects missing email or missing key', async () => {
    const r1 = await saveLicenseMapping({ email: '', licenseKey: testKey }, mockRedis);
    assert.equal(r1.success, false);

    const r2 = await saveLicenseMapping({ email: testEmail, licenseKey: '' }, mockRedis);
    assert.equal(r2.success, false);
  });

  // 5. Recovery flow: lookup-license returns 200 without exposing key in response
  it('5. lookup-license finds key and returns 200 without exposing key in response', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'development',
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: { email: testEmail },
        });
        const res = createMockRes();

        await lookupLicenseHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.success, true);
        assert.ok(res.body?.message);
        // CRITICAL SECURITY INVARIANT: never leak key in JSON
        assert.equal(res.body?.licenseKey, undefined);
      }
    );
  });

  // 6. Recovery flow: lookup-license rejects invalid email
  it('6. lookup-license rejects malformed email address', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { email: 'not-an-email' },
    });
    const res = createMockRes();

    await lookupLicenseHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error);
  });

  // 7. Full roundtrip: checkout key verified against recovered key
  it('7. Full roundtrip: checkout license key verifies identically upon recovery', async () => {
    // 1. Simulate key created at checkout
    const issuedAt = 1789559332;
    const checkoutKey = generateLicenseKey(testEmail, 'ProLifetime', null, issuedAt);

    // 2. Persist mapping to Upstash
    await saveLicenseMapping(
      {
        email: testEmail,
        customerId: testCustomerId,
        licenseKey: checkoutKey,
        createdAt: issuedAt,
      },
      mockRedis
    );

    // 3. Retrieve from Upstash via recovery
    const recovered = await getLicenseByEmail(testEmail, mockRedis);
    assert.ok(recovered, 'License record must be recovered from database');
    assert.equal(recovered.licenseKey, checkoutKey);

    // 4. Verify cryptographic signature of recovered key
    const verification = verifyLicenseKey(recovered.licenseKey);
    assert.equal(verification.valid, true);
    assert.equal(verification.payload.email, testEmail);
    assert.equal(verification.payload.tier, 'ProLifetime');
    assert.equal(verification.payload.issued_at, issuedAt);
  });
});
