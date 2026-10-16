import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import createOrderHandler from '../api/create-order.js';
import verifyPaymentHandler from '../api/verify-payment.js';
import { verifyLicenseKey } from '../lib/licensing.js';

// Helper to mock req/res for Node-style serverless handlers
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

test('Razorpay Integration Suite', async (t) => {
  const originalEnv = { ...process.env };
  const TEST_KEY_ID = 'rzp_test_ToUiqcDV3uJUSh';
  const TEST_KEY_SECRET = '1HI9n7A87XAxz2J0iSv8mgdm';

  t.beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
    process.env.WACPAD_LICENSE_SECRET = 'wacpad-license-key-v1-secret';
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('POST /api/create-order creates real Razorpay order with valid amount and currency', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: {
        amount: 129900, // ₹1,299.00
        currency: 'INR',
        email: 'artist@wacpad.com',
      },
    });

    await createOrderHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.ok(data.order_id);
    assert.ok(data.order_id.startsWith('order_'));
    assert.equal(data.amount, 129900);
    assert.equal(data.currency, 'INR');
    assert.equal(data.key_id, TEST_KEY_ID);
  });

  await t.test('POST /api/create-order rejects amounts under 100 paise', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { amount: 50 },
    });

    await createOrderHandler(req, res);
    assert.equal(res._getStatusCode(), 400);
    assert.match(res._getData().error, /Minimum order amount is 100 paise/);
  });

  await t.test('POST /api/create-order rejects non-POST requests', async () => {
    const { req, res } = mockReqRes({ method: 'GET' });
    await createOrderHandler(req, res);
    assert.equal(res._getStatusCode(), 405);
  });

  await t.test('POST /api/verify-payment succeeds and issues valid WP1- license on genuine HMAC signature', async () => {
    const orderId = 'order_test_' + crypto.randomBytes(4).toString('hex');
    const paymentId = 'pay_test_' + crypto.randomBytes(4).toString('hex');
    const signature = crypto
      .createHmac('sha256', TEST_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const customerEmail = 'tester@wacpad.com';

    const { req, res } = mockReqRes({
      method: 'POST',
      body: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
        email: customerEmail,
        name: 'Mohnish Kumar',
      },
    });

    await verifyPaymentHandler(req, res);

    assert.equal(res._getStatusCode(), 200);
    const data = res._getData();
    assert.equal(data.success, true);
    assert.ok(data.licenseKey);
    assert.ok(data.licenseKey.startsWith('WP1-'));

    // Cryptographic validation of the generated license key
    const verification = verifyLicenseKey(data.licenseKey);
    assert.equal(verification.valid, true);
    assert.equal(verification.payload.email, customerEmail);
    assert.equal(verification.payload.tier, 'ProLifetime');
  });

  await t.test('POST /api/verify-payment rejects forged/tampered payment signatures with 400', async () => {
    const orderId = 'order_test_fake';
    const paymentId = 'pay_test_fake';
    const badSignature = '0000000000000000000000000000000000000000000000000000000000000000';

    const { req, res } = mockReqRes({
      method: 'POST',
      body: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: badSignature,
        email: 'hacker@example.com',
      },
    });

    await verifyPaymentHandler(req, res);
    assert.equal(res._getStatusCode(), 400);
    assert.match(res._getData().error, /Invalid payment signature/);
  });

  await t.test('POST /api/verify-payment rejects missing required fields', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: {
        razorpay_order_id: 'order_123',
        // missing payment_id and signature
      },
    });

    await verifyPaymentHandler(req, res);
    assert.equal(res._getStatusCode(), 400);
  });
});
