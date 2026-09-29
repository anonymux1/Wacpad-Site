import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[route]].js';
import { adaptCloudflareRequest } from '../functions/_adapter.js';

describe('Cloudflare Pages Adapter & Router', () => {
  // 1. OPTIONS CORS preflight returns 204
  it('1. OPTIONS preflight returns 204 with standard CORS headers', async () => {
    const req = new Request('https://wacpad-site.pages.dev/api/create-checkout-session', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://wacpad-site.pages.dev',
      },
    });

    const res = await onRequest({ request: req, env: {} });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://wacpad-site.pages.dev');
    assert.ok(res.headers.get('Access-Control-Allow-Methods').includes('POST'));
  });

  // 2. Unknown route returns 404
  it('2. Request to non-existent API route returns 404', async () => {
    const req = new Request('https://wacpad-site.pages.dev/api/nonexistent-route', {
      method: 'GET',
    });

    const res = await onRequest({ request: req, env: {} });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Endpoint Not Found');
  });

  // 3. GET on POST-only endpoint returns 405
  it('3. GET method on POST-only endpoint returns 405 via adapter', async () => {
    const req = new Request('https://wacpad-site.pages.dev/api/create-checkout-session', {
      method: 'GET',
    });

    const res = await onRequest({
      request: req,
      env: { NODE_ENV: 'test' },
    });
    assert.equal(res.status, 405);
    const body = await res.json();
    assert.equal(body.error, 'Method Not Allowed');
  });

  // 4. POST /api/create-checkout-session in dev/test mode returns 200 with mock URL
  it('4. POST to create-checkout-session in test mode returns 200 with redirect URL', async () => {
    const req = new Request('https://wacpad-site.pages.dev/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'artist@wacpad.io' }),
    });

    const res = await onRequest({
      request: req,
      env: {
        NODE_ENV: 'development',
        BASE_URL: 'https://wacpad-site.pages.dev',
        STRIPE_SECRET_KEY: undefined,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.url, 'Response must have url');
    assert.ok(body.url.includes('success.html'), 'Mock URL must point to success.html');
  });

  // 5. GET /api/get-license returns licenseKey in mock mode
  it('5. GET to get-license with mock=true returns valid WP1- key', async () => {
    const req = new Request('https://wacpad-site.pages.dev/api/get-license?session_id=mock_sess_123&mock=true&email=artist@wacpad.io', {
      method: 'GET',
    });

    const res = await onRequest({
      request: req,
      env: {
        NODE_ENV: 'development',
        STRIPE_SECRET_KEY: undefined,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.licenseKey?.startsWith('WP1-'), 'Key must start with WP1-');
    assert.equal(body.email, 'artist@wacpad.io');
  });

  // 6. context.env injected into process.env
  it('6. Adapter properly injects context.env into process.env', async () => {
    const customSecret = 'test_custom_secret_12345';
    let seenEnvVal = null;

    const mockHandler = async (req, res) => {
      seenEnvVal = process.env.TEST_CUSTOM_SECRET;
      res.status(200).json({ success: true });
    };

    const req = new Request('https://wacpad-site.pages.dev/api/test', {
      method: 'POST',
    });

    await adaptCloudflareRequest(
      {
        request: req,
        env: { TEST_CUSTOM_SECRET: customSecret },
      },
      mockHandler
    );

    assert.equal(seenEnvVal, customSecret);
  });
});
