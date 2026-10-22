import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import createDodoCheckoutHandler from '../api/create-dodo-checkout.js';
import webhookDodoHandler from '../api/webhook-dodo.js';
import geoHandler from '../api/geo.js';
import { verifyLicenseKey } from '../lib/licensing.js';

function mockReqRes(options = {}) {
  let statusCode = 200;
  let headers = {};
  let bodyData = null;

  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || null,
    env: options.env || {},
  };

  const res = {
    statusCode: 200,
    setHeader(name, val) {
      headers[name.toLowerCase()] = val;
      return res;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data) {
      headers['content-type'] = 'application/json';
      bodyData = data;
      return res;
    },
    _getStatusCode: () => statusCode,
    _getData: () => bodyData,
  };

  return { req, res };
}

test('Dodo Payments & Geolocation Integration Suite', async (t) => {
  const originalEnv = { ...process.env };
  const TEST_DODO_KEY = 'cBy0QRAyAzWpSjdA.GrT4vqfRBNA_nTjDn9zJVPazKc4OLrbe9IJmio4SfEfXTVsH';
  const TEST_PRODUCT_ID = 'pdt_0NpqdjR6faKYqLtCgr6Ma';

  t.beforeEach(() => {
    process.env.DODO_PAYMENTS_API_KEY = TEST_DODO_KEY;
    process.env.DODO_PRODUCT_ID = TEST_PRODUCT_ID;
    process.env.DODO_ENV = 'test_mode';
    process.env.WACPAD_LICENSE_SECRET = 'wacpad-license-key-v1-secret';
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('POST /api/create-dodo-checkout creates real Dodo checkout session', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { email: 'dodo-artist@wacpad.com' },
    });

    await createDodoCheckoutHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.ok(data.url);
    assert.ok(data.url.includes('checkout.dodopayments.com'));
    assert.ok(data.session_id);
    assert.ok(data.session_id.startsWith('cks_'));
  });

  await t.test('POST /api/create-dodo-checkout rejects non-POST requests', async () => {
    const { req, res } = mockReqRes({ method: 'GET' });
    await createDodoCheckoutHandler(req, res);
    assert.equal(res._getStatusCode(), 405);
  });

  await t.test('POST /api/webhook-dodo provisions valid WP1- license on payment.succeeded', async () => {
    const paymentId = 'pay_dodo_' + crypto.randomBytes(4).toString('hex');
    const customerEmail = 'intl-buyer@gmail.com';

    const { req, res } = mockReqRes({
      method: 'POST',
      headers: {
        'webhook-id': 'evt_test_123',
      },
      body: {
        type: 'payment.succeeded',
        data: {
          payment_id: paymentId,
          total_amount: 999,
          currency: 'USD',
          customer: {
            email: customerEmail,
            name: 'International Creator',
          },
        },
      },
    });

    await webhookDodoHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.received, true);
    assert.ok(data.licenseKey);
    assert.ok(data.licenseKey.startsWith('WP1-'));

    const verification = verifyLicenseKey(data.licenseKey);
    assert.equal(verification.valid, true);
    assert.equal(verification.payload.email, customerEmail);
    assert.equal(verification.payload.tier, 'ProLifetime');
  });

  await t.test('GET /api/geo accurately flags India visitor from cf-ipcountry header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      headers: { 'cf-ipcountry': 'IN' },
    });

    await geoHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.isIndia, true);
    assert.equal(data.currency, 'INR');
    assert.equal(data.formattedPrice, '₹899');
    assert.equal(data.provider, 'razorpay');
  });

  await t.test('GET /api/geo accurately flags US/Global visitor from cf-ipcountry header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      headers: { 'cf-ipcountry': 'US' },
    });

    await geoHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.isIndia, false);
    assert.equal(data.currency, 'USD');
    assert.equal(data.formattedPrice, '$9.99');
    assert.equal(data.provider, 'dodo');
  });

  await t.test('GET /api/geo?geo=US query override overrides cf-ipcountry: IN header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      headers: { 'cf-ipcountry': 'IN' },
      query: { geo: 'US' },
    });

    await geoHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.isIndia, false);
    assert.equal(data.country, 'US');
    assert.equal(data.provider, 'dodo');
  });

  await t.test('GET /api/geo?geo=IN query override overrides cf-ipcountry: US header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      headers: { 'cf-ipcountry': 'US' },
      query: { geo: 'IN' },
    });

    await geoHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.isIndia, true);
    assert.equal(data.country, 'IN');
    assert.equal(data.provider, 'razorpay');
  });
});
