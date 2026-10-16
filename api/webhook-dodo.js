import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { generateLicenseKey } from '../lib/licensing.js';
import { sendLicenseEmail } from '../lib/email.js';
import { saveLicenseMapping, saveLicenseMappingD1 } from '../lib/db.js';

// In-memory idempotency set
const processedPayments = new Set();
const MAX_PROCESSED_PAYMENTS = 10000;

function recordPayment(paymentId) {
  if (processedPayments.size >= MAX_PROCESSED_PAYMENTS) {
    const oldest = processedPayments.values().next().value;
    if (oldest) processedPayments.delete(oldest);
  }
  processedPayments.add(paymentId);
}

/**
 * Handles Dodo Payments webhooks.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const webhookSecret = req.env?.DODO_PAYMENTS_WEBHOOK_KEY || process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  const isProduction = (req.env?.NODE_ENV || process.env.NODE_ENV) === 'production';

  const body = req.body || {};
  const sigHeader = req.headers?.['webhook-signature'];
  const webhookId = req.headers?.['webhook-id'];
  const webhookTimestamp = req.headers?.['webhook-timestamp'];

  // Signature verification in production if webhook secret configured
  if (webhookSecret && sigHeader) {
    try {
      const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
      const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
      // Standard Webhooks format: v1,<base64_hmac>
      const expectedHmac = crypto.createHmac('sha256', webhookSecret).update(toSign).digest('base64');
      const signatures = sigHeader.split(' ').map((s) => s.split(',')[1]);

      const isValid = signatures.some((sig) => {
        try {
          return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedHmac));
        } catch {
          return false;
        }
      });

      if (!isValid && isProduction) {
        console.error('[Dodo Webhook Signature Failed]');
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }
    } catch (err) {
      if (isProduction) {
        console.error('[Dodo Webhook Verification Error]:', err.message);
        return res.status(400).json({ error: 'Signature verification error' });
      }
    }
  }

  const eventType = body.type;
  console.log(`[Dodo Webhook] Received event: ${eventType}`);

  if (eventType === 'payment.succeeded' || eventType === 'order.created') {
    const paymentData = body.data || {};
    const paymentId = paymentData.payment_id || paymentData.id || webhookId;
    const customer = paymentData.customer || {};
    const customerEmail = (customer.email || '').trim().toLowerCase();
    const customerName = (customer.name || '').trim();

    if (!paymentId || !customerEmail) {
      return res.status(400).json({ error: 'Missing paymentId or customer email' });
    }

    if (processedPayments.has(paymentId)) {
      console.log(`[Dodo Webhook] Duplicate payment ignored: ${paymentId}`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    recordPayment(paymentId);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const licenseKey = generateLicenseKey(customerEmail, 'ProLifetime', null, timestamp);
      console.log(`[Dodo Webhook] Issued license key: ${licenseKey} for ${customerEmail}`);

      const d1 = req.env?.DB || process.env.DB;
      const licenseRecord = {
        email: customerEmail,
        customerId: customer.customer_id || paymentId,
        sessionId: paymentId,
        licenseKey,
        tier: 'ProLifetime',
        createdAt: timestamp,
      };

      if (d1) {
        await saveLicenseMappingD1(d1, licenseRecord).catch((dbErr) => {
          console.warn('[D1 Warning] Failed to save Dodo license mapping:', dbErr.message);
        });
      } else {
        await saveLicenseMapping(licenseRecord).catch((dbErr) => {
          console.warn('[DB Warning] Failed to save Dodo license mapping:', dbErr.message);
        });
      }

      await sendLicenseEmail({
        email: customerEmail,
        customerName: customerName || undefined,
        licenseKey,
        receiptUrl: `https://test.dodopayments.com/payments/${paymentId}`,
      }).catch((emailErr) => {
        console.warn('[Email Warning] Failed to send Dodo license email:', emailErr.message);
      });

      return res.status(200).json({ received: true, licenseKey });
    } catch (err) {
      console.error('[Dodo Webhook Fulfillment Error]:', err);
      return res.status(500).json({ error: 'License fulfillment failed' });
    }
  }

  return res.status(200).json({ received: true });
}
