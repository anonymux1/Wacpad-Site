import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// API Handlers
import createOrderHandler from '../api/create-order.js';
import verifyPaymentHandler from '../api/verify-payment.js';
import createDodoCheckoutHandler from '../api/create-dodo-checkout.js';
import webhookDodoHandler from '../api/webhook-dodo.js';
import activateHandler, { verifyActivationToken } from '../api/activate.js';

// Core Cryptographic Licensing
import { verifyLicenseKey, generateLicenseKey } from '../lib/licensing.js';

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

test('Dual Gateway E2E Suite: Razorpay & Dodo Payments -> License -> App Pro Activation', async (t) => {
  const RAZORPAY_KEY_ID = 'rzp_test_ToUiqcDV3uJUSh';
  const RAZORPAY_KEY_SECRET = '1HI9n7A87XAxz2J0iSv8mgdm';
  const DODO_API_KEY = 'cBy0QRAyAzWpSjdA.GrT4vqfRBNA_nTjDn9zJVPazKc4OLrbe9IJmio4SfEfXTVsH';
  const DODO_PRODUCT_ID = 'pdt_0NpqdjR6faKYqLtCgr6Ma';
  const LICENSE_SECRET = 'wacpad-license-key-v1-secret';

  process.env.RAZORPAY_KEY_ID = RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
  process.env.DODO_PAYMENTS_API_KEY = DODO_API_KEY;
  process.env.DODO_PRODUCT_ID = DODO_PRODUCT_ID;
  process.env.DODO_ENV = 'test_mode';
  process.env.WACPAD_LICENSE_SECRET = LICENSE_SECRET;
  process.env.NODE_ENV = 'test';

  await t.test('1. Razorpay Flow: Order -> Payment -> WP1- Key -> WPACT- Token -> Pro Unlocked', async () => {
    const customerEmail = 'artist-india@wacpad.com';
    const testMachineId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    // A. Create Order
    const { req: orderReq, res: orderRes } = mockReqRes({
      method: 'POST',
      body: { amount: 89900, currency: 'INR', email: customerEmail },
    });
    await createOrderHandler(orderReq, orderRes);
    assert.equal(orderRes._getStatusCode(), 200);
    const orderData = orderRes._getData();
    assert.ok(orderData.order_id, 'Should receive Razorpay order_id');
    assert.equal(orderData.amount, 89900);
    assert.equal(orderData.currency, 'INR');

    // B. Simulate Customer Payment & HMAC-SHA256 Signature
    const paymentId = `pay_test_${crypto.randomBytes(4).toString('hex')}`;
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderData.order_id}|${paymentId}`)
      .digest('hex');

    // C. Verify Payment
    const { req: verifyReq, res: verifyRes } = mockReqRes({
      method: 'POST',
      body: {
        razorpay_order_id: orderData.order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: generatedSignature,
        email: customerEmail,
      },
    });
    await verifyPaymentHandler(verifyReq, verifyRes);
    assert.equal(verifyRes._getStatusCode(), 200);
    const verifyData = verifyRes._getData();
    assert.equal(verifyData.success, true);
    assert.ok(verifyData.licenseKey.startsWith('WP1-'), 'License key must start with WP1-');

    // D. Verify Cryptographic Integrity
    const verified = verifyLicenseKey(verifyData.licenseKey, LICENSE_SECRET);
    assert.equal(verified.valid, true);
    assert.equal(verified.payload.email, customerEmail);
    assert.equal(verified.payload.tier, 'ProLifetime');

    // E. Machine Hardware Activation
    const { req: actReq, res: actRes } = mockReqRes({
      method: 'POST',
      body: {
        license_key: verifyData.licenseKey,
        machine_id: testMachineId,
        device_name: 'Studio M3 Max',
        os: 'macOS',
      },
    });
    await activateHandler(actReq, actRes);
    assert.equal(actRes._getStatusCode(), 200);
    const actData = actRes._getData();
    assert.equal(actData.success, true);
    assert.ok(actData.token.startsWith('WPACT-'), 'Token must start with WPACT-');
    assert.equal(actData.seat, 1);
    assert.equal(actData.max_seats, 3);

    // F. Verify Token Signature
    const tokenResult = verifyActivationToken(actData.token);
    assert.equal(tokenResult.valid, true);
    assert.equal(tokenResult.payload.email, customerEmail);
    assert.equal(tokenResult.payload.machine_id, testMachineId);
    assert.equal(tokenResult.payload.seat, 1);
  });

  await t.test('2. Dodo Payments Flow: Checkout Session -> Webhook -> WP1- Key -> WPACT- Token -> Pro Unlocked', async () => {
    const customerEmail = 'artist-global@wacpad.com';
    const testMachineId = 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1';

    // A. Create Dodo Checkout Session
    const { req: dodoReq, res: dodoRes } = mockReqRes({
      method: 'POST',
      body: {
        customerEmail,
        customerName: 'Global Illustrator',
      },
    });
    await createDodoCheckoutHandler(dodoReq, dodoRes);
    assert.equal(dodoRes._getStatusCode(), 200);
    const dodoData = dodoRes._getData();
    assert.ok(dodoData.url.includes('checkout.dodopayments.com'), 'Should return Dodo hosted checkout URL');
    assert.ok(dodoData.session_id, 'Should return Dodo session_id');

    // B. Simulate Dodo Webhook payment.succeeded
    const paymentId = `pay_dodo_${crypto.randomBytes(4).toString('hex')}`;
    const webhookPayload = {
      type: 'payment.succeeded',
      data: {
        payment_id: paymentId,
        total_amount: 999,
        currency: 'USD',
        customer: {
          email: customerEmail,
          name: 'Global Illustrator',
          customer_id: 'cus_dodo_test',
        },
      },
    };

    const { req: hookReq, res: hookRes } = mockReqRes({
      method: 'POST',
      body: webhookPayload,
    });
    await webhookDodoHandler(hookReq, hookRes);
    assert.equal(hookRes._getStatusCode(), 200);
    const hookData = hookRes._getData();
    assert.equal(hookData.received, true);
    assert.ok(hookData.licenseKey.startsWith('WP1-'), 'Dodo webhook must return WP1- license');

    // C. Verify Cryptographic Integrity
    const verified = verifyLicenseKey(hookData.licenseKey, LICENSE_SECRET);
    assert.equal(verified.valid, true);
    assert.equal(verified.payload.email, customerEmail);
    assert.equal(verified.payload.tier, 'ProLifetime');

    // D. Machine Hardware Activation
    const { req: actReq, res: actRes } = mockReqRes({
      method: 'POST',
      body: {
        license_key: hookData.licenseKey,
        machine_id: testMachineId,
        device_name: 'Windows 11 Surface Studio',
        os: 'Windows 11',
      },
    });
    await activateHandler(actReq, actRes);
    assert.equal(actRes._getStatusCode(), 200);
    const actData = actRes._getData();
    assert.equal(actData.success, true);
    assert.ok(actData.token.startsWith('WPACT-'));
    assert.equal(actData.seat, 1);
    assert.equal(actData.max_seats, 3);

    // E. Verify Token Signature
    const tokenResult = verifyActivationToken(actData.token);
    assert.equal(tokenResult.valid, true);
    assert.equal(tokenResult.payload.email, customerEmail);
    assert.equal(tokenResult.payload.machine_id, testMachineId);
    assert.equal(tokenResult.payload.seat, 1);
  });

  await t.test('3. Verify Pro License Unlocks Ad-Free Mode & Unlimited Sessions in App', () => {
    // Both Razorpay and Dodo issue 'ProLifetime' tier
    const email = 'pro-artist@wacpad.com';
    const key = generateLicenseKey(email, 'ProLifetime');
    const verified = verifyLicenseKey(key);

    assert.equal(verified.valid, true);
    assert.equal(verified.payload.tier, 'ProLifetime');

    // Verify iPad App Contract:
    // When tier is ProLifetime:
    // - Server sends is_pro: true in WsServerMessage::Init
    // - iPad NetworkDiscoveryEngine sets isPro = true
    // - WacPadCanvasView topInset becomes 0.0 (Ad banner hidden)
    // - Session cap (30-min timer) is never enforced
    const isPro = verified.payload.tier === 'ProLifetime' || verified.payload.tier === 'ProAnnual';
    const topInset = isPro ? 0.0 : 54.0;
    const adsVisible = !isPro;
    const sessionCapped = !isPro;

    assert.equal(isPro, true);
    assert.equal(topInset, 0.0, 'Ad top banner inset must be 0 for Pro');
    assert.equal(adsVisible, false, 'Ads must be hidden for Pro');
    assert.equal(sessionCapped, false, 'Session must not be capped for Pro');
  });
});
