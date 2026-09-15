import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import createCheckoutSessionHandler from '../api/create-checkout-session.js';
import getLicenseHandler from '../api/get-license.js';
import webhookHandler from '../api/webhook.js';
import lookupLicenseHandler from '../api/lookup-license.js';
import { verifyLicenseKey } from '../lib/licensing.js';

import { createMockReq, createMockRes, withEnvAsync } from './helpers.js';

describe('API: create-checkout-session', () => {
  it('1. create-checkout-session: GET returns 405', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await createCheckoutSessionHandler(req, res);
    assert.equal(res.statusCode, 405, `Expected 405 for GET on checkout session, got ${res.statusCode}`);
  });

  it('2. create-checkout-session: POST without STRIPE_SECRET_KEY (non-production) returns mock URL', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        body: { email: 'artist@wacpad.io' },
        headers: { origin: 'http://localhost:3000' },
      });
      const res = createMockRes();
      await createCheckoutSessionHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.url, 'Should return a redirect url in JSON response');
      assert.ok(
        res.body.url.includes('session_id=mock_') || res.body.url.includes('mock=true'),
        `Expected mock URL, got: ${res.body.url}`
      );
    });
  });

  it('3. create-checkout-session: POST in production without STRIPE_SECRET_KEY returns 403', async () => {
    await withEnvAsync({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        body: { email: 'artist@wacpad.io' },
      });
      const res = createMockRes();
      await createCheckoutSessionHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden when STRIPE_SECRET_KEY is missing in production, got ${res.statusCode}`
      );
    });
  });

  it('4. create-checkout-session: customer email provided in POST body is preserved in mock session', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const targetEmail = 'pro-creator@example.com';
      const req = createMockReq({
        method: 'POST',
        body: { email: targetEmail },
        headers: { origin: 'http://localhost:3000' },
      });
      const res = createMockRes();
      await createCheckoutSessionHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.url.includes(encodeURIComponent(targetEmail)));
    });
  });

  it('5. create-checkout-session: unsupported HTTP methods (PUT/DELETE) return 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const req = createMockReq({ method });
      const res = createMockRes();
      await createCheckoutSessionHandler(req, res);
      assert.equal(res.statusCode, 405, `Expected 405 for ${method}, got ${res.statusCode}`);
    }
  });
});

describe('API: get-license', () => {
  it('6. get-license: missing session_id returns 400', async () => {
    const req = createMockReq({ method: 'GET', query: {} });
    const res = createMockRes();
    await getLicenseHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error, 'Should contain error description');
  });

  it('7. get-license: mock=true in non-production returns valid key', async () => {
    await withEnvAsync({ NODE_ENV: 'test' }, async () => {
      const testEmail = 'digitalartist@wacpad.io';
      const req = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_sess_123', mock: 'true', email: testEmail },
      });
      const res = createMockRes();
      await getLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.licenseKey, 'Must return licenseKey in response');
      assert.ok(res.body.licenseKey.startsWith('WP1-'));

      const verification = verifyLicenseKey(res.body.licenseKey);
      assert.equal(verification.valid, true);
      assert.equal(verification.payload.email, testEmail);
    });
  });

  it('8. get-license: mock=true in production returns 403', async () => {
    await withEnvAsync({ NODE_ENV: 'production' }, async () => {
      const req = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_sess_123', mock: 'true' },
      });
      const res = createMockRes();
      await getLicenseHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden for mock mode in production, got ${res.statusCode}`
      );
    });
  });

  it('9. get-license: GET method accepted', async () => {
    await withEnvAsync({ NODE_ENV: 'test' }, async () => {
      const req = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_accepted_test', mock: 'true' },
      });
      const res = createMockRes();
      await getLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
    });
  });

  it('10. get-license: POST method returns 405', async () => {
    const req = createMockReq({
      method: 'POST',
      query: { session_id: 'mock_post_test', mock: 'true' },
    });
    const res = createMockRes();
    await getLicenseHandler(req, res);

    assert.equal(res.statusCode, 405);
  });

  it('11. Deterministic keys: get-license with same session.created returns same key', async () => {
    await withEnvAsync({ NODE_ENV: 'test' }, async () => {
      const req1 = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_deterministic_session', mock: 'true', email: 'consistent@wacpad.io' },
      });
      const res1 = createMockRes();
      await getLicenseHandler(req1, res1);

      const req2 = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_deterministic_session', mock: 'true', email: 'consistent@wacpad.io' },
      });
      const res2 = createMockRes();
      await getLicenseHandler(req2, res2);

      assert.equal(res1.statusCode, 200);
      assert.equal(res2.statusCode, 200);
      assert.ok(res1.body?.licenseKey);
      assert.equal(
        res1.body.licenseKey,
        res2.body?.licenseKey,
        'License key must be deterministic for the same session'
      );
    });
  });

  it('12. get-license: mock mode returns expected JSON response schema', async () => {
    await withEnvAsync({ NODE_ENV: 'test' }, async () => {
      const req = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_schema_test', mock: 'true', email: 'schema@wacpad.io' },
      });
      const res = createMockRes();
      await getLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.success, true);
      assert.equal(res.body?.email, 'schema@wacpad.io');
      assert.ok(res.body?.customerName);
      assert.ok(res.body?.licenseKey);
      assert.ok(res.body?.amount);
      assert.ok(res.body?.currency);
    });
  });
});

describe('API: webhook', () => {
  it('13. webhook: GET returns 405', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await webhookHandler(req, res);

    assert.equal(res.statusCode, 405);
  });

  it('14. webhook: POST without stripe-signature in production returns 400', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_dummy_key_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_dummy_webhook_secret_456',
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          headers: {}, // intentionally missing stripe-signature header
          body: { type: 'checkout.session.completed' },
        });
        const res = createMockRes();
        await webhookHandler(req, res);

        assert.ok(
          res.statusCode === 400 || res.statusCode === 401,
          `Expected 400/401 for webhook lacking signature, got: ${res.statusCode}`
        );
      }
    );
  });

  it('15. webhook: PUT or other methods return 405', async () => {
    const req = createMockReq({ method: 'PUT' });
    const res = createMockRes();
    await webhookHandler(req, res);

    assert.equal(res.statusCode, 405);
  });

  it('16. webhook: non-production event without signature handled gracefully', async () => {
    await withEnvAsync(
      {
        NODE_ENV: 'test',
        STRIPE_SECRET_KEY: 'sk_test_dummy_key_123',
        STRIPE_WEBHOOK_SECRET: undefined,
      },
      async () => {
        const req = createMockReq({
          method: 'POST',
          body: {
            type: 'checkout.session.completed',
            data: {
              object: {
                id: 'cs_test_mock_123',
                customer_email: 'webhook-user@wacpad.io',
                customer_details: { email: 'webhook-user@wacpad.io', name: 'Webhook User' },
              },
            },
          },
        });
        const res = createMockRes();
        await webhookHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.received, true);
      }
    );
  });
});

describe('API: lookup-license', () => {
  it('17. lookup-license: GET returns 405', async () => {
    const req = createMockReq({
      method: 'GET',
      headers: { 'x-forwarded-for': '10.10.1.17' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);

    assert.equal(res.statusCode, 405);
  });

  it('18. lookup-license: invalid email returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.1.18' },
      body: { email: 'invalid-email-without-at-sign' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error);
  });

  it('19. lookup-license: empty email returns 400', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.1.19' },
      body: { email: '' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error);
  });

  it('20. lookup-license: valid email format accepted (mock mode non-production returns success)', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.10.1.20' },
        body: { email: 'artist@wacpad.io' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.success, true);
    });
  });

  it('21. lookup-license: mock mode in production returns 403', async () => {
    await withEnvAsync({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.10.1.21' },
        body: { email: 'artist@wacpad.io' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden for lookup mock mode in production, got ${res.statusCode}`
      );
    });
  });

  it('22. lookup-license: response does NOT contain licenseKey field (email-only delivery)', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.10.1.22' },
        body: { email: 'artist@wacpad.io' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.strictEqual(
        res.body?.licenseKey,
        undefined,
        'Security requirement: licenseKey must NOT be returned in API response; it should only be delivered via email'
      );
    });
  });

  it('23. lookup-license: email with extra whitespace is trimmed and processed', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.10.1.23' },
        body: { email: '   padded-user@wacpad.io   ' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
    });
  });
});
