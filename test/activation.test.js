import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import activateHandler, {
  mintActivationToken,
  verifyActivationToken,
  DEFAULT_DEV_PRIVATE_KEY,
  DEFAULT_DEV_PUBLIC_KEY,
  MAX_SEATS,
} from '../api/activate.js';
import deactivateHandler from '../api/deactivate.js';
import devicesHandler from '../api/devices.js';
import { generateLicenseKey } from '../lib/licensing.js';
import { createMockReq, createMockRes, withEnvAsync } from './helpers.js';

describe('API: activate, deactivate, devices & token minting', () => {
  const testEmail = 'artist@wacpad.io';
  const testSecret = 'wacpad-license-key-v1-secret';
  const validKey = generateLicenseKey(testEmail, 'ProLifetime', null, 1700000000, testSecret);
  const testMachineId = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  // 1. activate: POST-only enforcement (GET returns 405)
  it('1. activate: POST-only enforcement (GET returns 405)', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await activateHandler(req, res);
    assert.equal(res.statusCode, 405, `Expected 405 for GET on /api/activate, got ${res.statusCode}`);
  });

  // 2. activate: missing license_key returns 400
  it('2. activate: missing license_key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { machine_id: testMachineId },
    });
    const res = createMockRes();
    await activateHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error?.includes('license_key'));
  });

  // 3. activate: missing machine_id returns 400
  it('3. activate: missing machine_id returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { license_key: validKey },
    });
    const res = createMockRes();
    await activateHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error?.includes('machine_id'));
  });

  // 4. activate: invalid WP1- key returns 400
  it('4. activate: invalid WP1- key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: {
        license_key: 'WP1-invalidbase64contenthere!!',
        machine_id: testMachineId,
      },
    });
    const res = createMockRes();
    await activateHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error);
  });

  // 5. activate: valid key in mock mode returns 200 with token starting with WPACT-
  it('5. activate: valid key in mock mode returns 200 with token starting with WPACT-', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
            os: 'macOS',
            device_name: 'MacBook Pro',
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.success, true);
        assert.ok(typeof res.body?.token === 'string');
        assert.ok(
          res.body.token.startsWith('WPACT-'),
          `Token should start with WPACT-, got: ${res.body?.token}`
        );
      }
    );
  });

  // 6. activate: mock mode returns seat count and max_seats
  it('6. activate: mock mode returns seat count and max_seats', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.seat, 1);
        assert.equal(res.body?.max_seats, MAX_SEATS);
      }
    );
  });

  // 7. activate: production mode without Redis returns 500
  it('7. activate: production mode without Redis returns 500', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'production',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(
          res.statusCode,
          500,
          `Expected 500 when Redis is unconfigured in production, got ${res.statusCode}`
        );
        assert.ok(res.body?.error?.includes('Activation database unconfigured'));
      }
    );
  });

  // 8. activate: test mode without STRIPE_SECRET_KEY still works in mock mode
  it('8. activate: test mode without STRIPE_SECRET_KEY still works in mock mode', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        STRIPE_SECRET_KEY: undefined,
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.success, true);
        assert.ok(res.body?.token?.startsWith('WPACT-'));
      }
    );
  });

  // 9. deactivate: POST-only enforcement
  it('9. deactivate: POST-only enforcement', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await deactivateHandler(req, res);
    assert.equal(res.statusCode, 405, `Expected 405 for GET on /api/deactivate, got ${res.statusCode}`);
  });

  // 10. deactivate: missing license_key returns 400
  it('10. deactivate: missing license_key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { machine_id: testMachineId },
    });
    const res = createMockRes();
    await deactivateHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error?.includes('license_key'));
  });

  // 11. deactivate: valid key in mock mode returns 200 with success
  it('11. deactivate: valid key in mock mode returns 200 with success', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await deactivateHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.success, true);
        assert.equal(res.body?.seats_used, 0);
      }
    );
  });

  // 12. devices: POST-only enforcement
  it('12. devices: POST-only enforcement', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await devicesHandler(req, res);
    assert.equal(res.statusCode, 405, `Expected 405 for GET on /api/devices, got ${res.statusCode}`);
  });

  // 13. devices: missing license_key returns 400
  it('13. devices: missing license_key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: {},
    });
    const res = createMockRes();
    await devicesHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error?.includes('license_key'));
  });

  // 14. devices: valid key in mock mode returns device list
  it('14. devices: valid key in mock mode returns device list', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: { license_key: validKey },
        });
        const res = createMockRes();
        await devicesHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.success, true);
        assert.ok(Array.isArray(res.body?.devices), 'Expected devices array');
        assert.ok(res.body.devices.length > 0, 'Expected at least 1 mock device');
        assert.ok(res.body.devices[0].machine_id);
        assert.ok(res.body.devices[0].device_name);
        assert.equal(res.body?.seats_used, 1);
        assert.equal(res.body?.max_seats, MAX_SEATS);
      }
    );
  });

  // 15. Token minting: WPACT- token signed with Ed25519 verifies correctly
  it('15. Token minting: WPACT- token signed with Ed25519 verifies correctly', () => {
    const payload = {
      email: testEmail,
      machine_id: testMachineId,
      seat: 2,
      max_seats: MAX_SEATS,
      activated_at: 1700000000,
    };

    const token = mintActivationToken(payload, DEFAULT_DEV_PRIVATE_KEY);
    assert.ok(token.startsWith('WPACT-'), `Token must start with WPACT-, got ${token}`);

    const b64 = token.slice(6);
    const decoded = Buffer.from(b64, 'base64');
    assert.ok(decoded.length >= 65, 'Decoded token must contain payload + 64-byte Ed25519 signature');

    const verified = verifyActivationToken(token, DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(verified.valid, true);
    assert.equal(verified.payload.email, testEmail);
    assert.equal(verified.payload.machine_id, testMachineId);
    assert.equal(verified.payload.seat, 2);
  });

  // 16. Token minting: mismatched keypairs fail verification
  it('16. Token minting: mismatched keypairs fail verification', () => {
    const { privateKey: privA } = crypto.generateKeyPairSync('ed25519');
    const { publicKey: pubB } = crypto.generateKeyPairSync('ed25519');

    const payload = { email: testEmail, machine_id: testMachineId, seat: 1 };
    const tokenA = mintActivationToken(payload, privA);

    const verifiedWrong = verifyActivationToken(tokenA, pubB);
    assert.equal(verifiedWrong.valid, false);
    assert.equal(verifiedWrong.error, 'Invalid Ed25519 signature');
  });

  // 17. Production lockdown: activate blocked when NODE_ENV=production and no Redis configured
  it('17. Production lockdown: activate blocked when NODE_ENV=production and no Redis configured', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'production',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(
          res.statusCode,
          500,
          `Expected 500 database unconfigured in production, got ${res.statusCode}`
        );
        assert.equal(res.body?.error, 'Activation database unconfigured');
      }
    );
  });

  // Additional security & edge cases
  it('18. deactivate: missing machine_id returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { license_key: validKey },
    });
    const res = createMockRes();
    await deactivateHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error?.includes('machine_id'));
  });

  it('19. deactivate: invalid license key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { license_key: 'WP1-tamperedkey', machine_id: testMachineId },
    });
    const res = createMockRes();
    await deactivateHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('20. devices: invalid license key returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { license_key: 'WP1-invalidkey' },
    });
    const res = createMockRes();
    await devicesHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  // 21. Token verification: corrupt, truncated, or legacy HMAC tokens rejected with diagnostics
  it('21. Token verification: corrupt, truncated, or legacy HMAC tokens rejected with diagnostics', () => {
    assert.equal(verifyActivationToken('', DEFAULT_DEV_PUBLIC_KEY).valid, false);
    assert.equal(verifyActivationToken('INVALID-abc', DEFAULT_DEV_PUBLIC_KEY).valid, false);

    // Invalid Base64 characters
    const invalidB64 = verifyActivationToken('WPACT-not_valid_b64!@#$', DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(invalidB64.valid, false);
    assert.equal(invalidB64.error, 'Invalid Base64 encoding');
    
    // Very short (< 32 bytes)
    const shortToken = `WPACT-${Buffer.from('short').toString('base64')}`;
    const shortRes = verifyActivationToken(shortToken, DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(shortRes.valid, false);
    assert.equal(shortRes.error, 'Token payload is too short');

    // Legacy HMAC length (between 32 and 64 bytes)
    const legacyBytes = Buffer.alloc(40, 0x42);
    const legacyToken = `WPACT-${legacyBytes.toString('base64')}`;
    const legacyRes = verifyActivationToken(legacyToken, DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(legacyRes.valid, false);
    assert.equal(
      legacyRes.error,
      'Incompatible token format (detected legacy HMAC token; Ed25519 signature required)'
    );

    // Full legacy HMAC token with JSON payload (> 65 bytes total: JSON + 32-byte HMAC)
    const legacyPayload = {
      email: testEmail,
      license_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      machine_id: testMachineId,
      seat: 1,
      max_seats: 3,
      activated_at: 1789500000,
    };
    const legacyJsonBytes = Buffer.from(JSON.stringify(legacyPayload), 'utf8');
    const legacyHmacSig = crypto.createHmac('sha256', 'old-hmac-secret').update(legacyJsonBytes).digest();
    const fullLegacyToken = `WPACT-${Buffer.concat([legacyJsonBytes, legacyHmacSig]).toString('base64')}`;
    assert.ok(Buffer.from(fullLegacyToken.slice(6), 'base64').length >= 65, 'Legacy token must be >= 65 bytes');
    const fullLegacyRes = verifyActivationToken(fullLegacyToken, DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(fullLegacyRes.valid, false);
    assert.equal(
      fullLegacyRes.error,
      'Incompatible token format (detected legacy HMAC token; Ed25519 signature required)'
    );

    // Non-object payload rejected
    const nonObjectToken = mintActivationToken(['not', 'an', 'object'], DEFAULT_DEV_PRIVATE_KEY);
    const nonObjectRes = verifyActivationToken(nonObjectToken, DEFAULT_DEV_PUBLIC_KEY);
    assert.equal(nonObjectRes.valid, false);
    assert.equal(nonObjectRes.error, 'Corrupt token JSON: payload must be a JSON object');
  });

  // 22. Strict secret hygiene: private key is NEVER leaked in responses
  it('22. Strict secret hygiene: private key is NEVER leaked in responses', async () => {
    const customSecret = '9999999999999999999999999999999999999999999999999999999999999999';
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        ACTIVATION_TOKEN_PRIVATE_KEY: customSecret,
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        STRIPE_SECRET_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 200);
        const serialized = JSON.stringify(res.body);
        assert.ok(
          !serialized.includes(customSecret),
          'Response payload must NEVER contain the private key seed!'
        );
      }
    );
  });

  // 23. Production lockdown: missing or default private key returns 500
  it('23. Production lockdown: missing or default private key returns 500', async () => {
    // Missing private key in production returns 500
    await withEnvAsync(
      {
        NODE_ENV: 'production',
        UPSTASH_REDIS_REST_URL: 'https://mock-redis.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
        ACTIVATION_TOKEN_PRIVATE_KEY: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body?.error, 'Server token signing key configuration error');
      }
    );

    // Default dev private key in production returns 500
    await withEnvAsync(
      {
        NODE_ENV: 'production',
        UPSTASH_REDIS_REST_URL: 'https://mock-redis.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
        ACTIVATION_TOKEN_PRIVATE_KEY: DEFAULT_DEV_PRIVATE_KEY,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            license_key: validKey,
            machine_id: testMachineId,
          },
        });
        const res = createMockRes();
        await activateHandler(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body?.error, 'Server token signing key configuration error');
      }
    );
  });
});
