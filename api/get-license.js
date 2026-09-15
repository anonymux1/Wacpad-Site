import Stripe from 'stripe';
import { generateLicenseKey } from '../lib/licensing.js';

/**
 * Retrieves and generates the license key for a paid Stripe checkout session.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { session_id, mock, email } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id parameter' });
  }

  // Production guard: mock mode is strictly disabled in production
  if (process.env.NODE_ENV === 'production' && (mock === 'true' || session_id.startsWith('mock_'))) {
    return res.status(403).json({ error: 'Mock mode is disabled in production' });
  }

  // Support test / mock flow when running without live Stripe keys (non-production only)
  if (mock === 'true' || session_id.startsWith('mock_')) {
    const targetEmail = email || 'artist@wacpad.io';
    const licenseKey = generateLicenseKey(targetEmail, 'ProLifetime');
    return res.status(200).json({
      success: true,
      simulated: true,
      email: targetEmail,
      customerName: 'Demo Artist',
      licenseKey,
      amount: '$14.99',
      currency: 'USD',
    });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'Stripe secret key not configured on server' });
  }

  const stripe = new Stripe(secretKey);

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(402).json({
        success: false,
        error: `Payment is not completed. Current status: ${session.payment_status}`,
      });
    }

    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerName = session.customer_details?.name || 'WacPad Creator';

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        error: 'Unable to determine customer email from Stripe session',
      });
    }

    // Generate cryptographic license key using immutable Stripe session creation timestamp
    const licenseKey = generateLicenseKey(customerEmail, 'ProLifetime', null, session.created);

    return res.status(200).json({
      success: true,
      email: customerEmail,
      customerName,
      licenseKey,
      amount: (session.amount_total / 100).toFixed(2),
      currency: session.currency?.toUpperCase() || 'USD',
    });
  } catch (err) {
    console.error('[Get License Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve license' });
  }
}
