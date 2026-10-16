import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { generateLicenseKey } from '../lib/licensing.js';
import { sendLicenseEmail } from '../lib/email.js';
import { saveLicenseMapping, saveLicenseMappingD1 } from '../lib/db.js';

/**
 * Verifies Razorpay payment signature and provisions WacPad Pro license key.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const keySecret = req.env?.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
  const body = req.body || {};

  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  const customerEmail = (body.email || '').trim().toLowerCase();
  const customerName = (body.name || '').trim();

  // Validate required fields
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'Missing required Razorpay payment verification fields' });
  }

  if (!customerEmail || !customerEmail.includes('@')) {
    return res.status(400).json({ error: 'Valid customer email is required for license issuance' });
  }

  // Verify HMAC-SHA256 signature
  if (!keySecret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Razorpay secret key not configured' });
    }
    console.warn('[Razorpay] KEY_SECRET not configured. Allowing test verification.');
  } else {
    const text = `${orderId}|${paymentId}`;
    const generatedSignature = crypto.createHmac('sha256', keySecret).update(text).digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const generatedBuffer = Buffer.from(generatedSignature, 'utf8');

    if (signatureBuffer.length !== generatedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, generatedBuffer)) {
      console.error(`[Razorpay Signature Mismatch] Order: ${orderId}, Payment: ${paymentId}`);
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
  }

  console.log(`[Razorpay Verified] Order: ${orderId}, Payment: ${paymentId}, Email: ${customerEmail}`);

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    // Deterministic license key issuance tied to payment
    const licenseKey = generateLicenseKey(customerEmail, 'ProLifetime', null, timestamp);

    // Save to Cloudflare D1 or fallback DB
    const d1 = req.env?.DB || process.env.DB;
    const licenseRecord = {
      email: customerEmail,
      customerId: paymentId,
      sessionId: orderId,
      licenseKey,
      tier: 'ProLifetime',
      createdAt: timestamp,
    };

    if (d1) {
      await saveLicenseMappingD1(d1, licenseRecord).catch((dbErr) => {
        console.warn('[D1 Warning] Failed to save Razorpay license mapping:', dbErr.message);
      });
    } else {
      await saveLicenseMapping(licenseRecord).catch((dbErr) => {
        console.warn('[DB Warning] Failed to save Razorpay license mapping:', dbErr.message);
      });
    }

    // Deliver via email
    await sendLicenseEmail({
      email: customerEmail,
      customerName: customerName || undefined,
      licenseKey,
      receiptUrl: `https://dashboard.razorpay.com/app/payments/${paymentId}`,
    }).catch((emailErr) => {
      console.warn('[Email Warning] Failed to send Razorpay license email:', emailErr.message);
    });

    const redirectUrl = `/success.html?session_id=${encodeURIComponent(paymentId)}&email=${encodeURIComponent(customerEmail)}&license_key=${encodeURIComponent(licenseKey)}`;

    return res.status(200).json({
      success: true,
      licenseKey,
      redirectUrl,
    });
  } catch (err) {
    console.error('[Razorpay Fulfillment Error]:', err);
    return res.status(500).json({ error: 'Payment verified but failed to provision license' });
  }
}
