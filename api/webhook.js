import Stripe from 'stripe';
import { generateLicenseKey } from '../lib/licensing.js';
import { sendLicenseEmail } from '../lib/email.js';
import { saveLicenseMapping } from '../lib/db.js';

// Disable default Vercel body parsing so Stripe webhook signature can be verified against raw buffer
export const config = {
  api: {
    bodyParser: false,
  },
};

// Module-level idempotency set with FIFO/LRU eviction capped at 10,000 entries
const processedSessions = new Set();
const MAX_PROCESSED_SESSIONS = 10000;

/**
 * Records a session ID as processed, evicting the oldest if limit reached.
 * @param {string} sessionId
 */
function recordProcessedSession(sessionId) {
  if (processedSessions.size >= MAX_PROCESSED_SESSIONS) {
    const oldest = processedSessions.values().next().value;
    if (oldest) {
      processedSessions.delete(oldest);
    }
  }
  processedSessions.add(sessionId);
}

/**
 * Helper to buffer the raw request stream or reuse pre-buffered body.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
async function getRawBody(req) {
  if (req.rawBody) {
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Handles Stripe webhook events with strict signature verification in production
 * and idempotency tracking.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;

  if (isProduction) {
    // In production, require BOTH webhookSecret and stripe-signature. Reject immediately if missing.
    if (!webhookSecret || !sig) {
      console.error('[Webhook Error] Webhook secret or stripe-signature missing in production');
      return res.status(400).json({ error: 'Webhook signature verification required' });
    }

    if (!secretKey) {
      console.error('[Webhook Error] STRIPE_SECRET_KEY is missing in production');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    const stripe = new Stripe(secretKey);
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('[Webhook Signature Verification Failed]:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }
  } else {
    // Non-production environment: verify if secrets present, else allow JSON fallback with prominent warning
    if (webhookSecret && sig && secretKey) {
      try {
        const stripe = new Stripe(secretKey);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        console.error('[Webhook Signature Verification Failed]:', err.message);
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }
    } else {
      console.warn('⚠️ [SECURITY WARNING] Processing unverified webhook event without signature check (Local Testing Only).');
      try {
        event = JSON.parse(rawBody.toString('utf8'));
      } catch (err) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }
    }
  }

  try {
    // Handle successful checkout session completion
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      if (!session || !session.id) {
        return res.status(400).json({ error: 'Invalid session payload' });
      }

      // Idempotency check: prevent duplicate fulfillment
      if (processedSessions.has(session.id)) {
        console.log(`[Webhook] Duplicate checkout session ignored: ${session.id}`);
        return res.status(200).json({ received: true, duplicate: true });
      }

      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name;
      const receiptUrl = session.receipt_url || (session.invoice ? `https://pay.stripe.com/invoice/${session.invoice}` : null);

      console.log(`[Webhook] Payment completed for ${customerEmail}, Session: ${session.id}`);

      if (customerEmail) {
        // Deterministic license key issuance using immutable session.created
        const licenseKey = generateLicenseKey(customerEmail, 'ProLifetime', null, session.created);
        console.log(`[Webhook] Issued license key: ${licenseKey} to ${customerEmail}`);

        // Persist user email <-> license key mapping in Upstash Redis
        await saveLicenseMapping({
          email: customerEmail,
          customerId: session.customer,
          sessionId: session.id,
          licenseKey,
          tier: 'ProLifetime',
          createdAt: session.created,
        }).catch((dbErr) => {
          console.warn('[DB Warning] Failed to save license mapping in webhook:', dbErr.message);
        });

        // Deliver via email (Resend or simulated)
        await sendLicenseEmail({
          email: customerEmail,
          customerName,
          licenseKey,
          receiptUrl,
        });
      }

      // Record session as processed after successful handling
      recordProcessedSession(session.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook Error]', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
