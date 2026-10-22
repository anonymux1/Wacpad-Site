import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Creates a Razorpay Order for WacPad Pro Lifetime License.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const keyId = req.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = req.env?.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  // Retrieve amount (in paise), currency, and optional customer email/name from request
  const body = req.body || {};
  let amount = 89900; // Default ₹899.00
  if (body.amount !== undefined && body.amount !== null) {
    const requestedAmount = parseInt(body.amount, 10);
    if (isNaN(requestedAmount) || requestedAmount < 100) {
      return res.status(400).json({ error: 'Minimum order amount is 100 paise (₹1.00)' });
    }
    amount = requestedAmount;
  }
  const currency = body.currency || 'INR';
  const customerEmail = body.email || null;
  const customerName = body.name || null;

  // Fallback for mock mode if keys are not configured and not in production
  const isInvalidKey = !keyId || !keySecret || keyId.startsWith('mock_');
  if (isInvalidKey) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Razorpay service not configured in production' });
    }
    console.warn('[Razorpay] Keys not set. Generating mock order for local testing.');
    const mockOrderId = 'order_mock_' + crypto.randomBytes(6).toString('hex');
    return res.status(200).json({
      order_id: mockOrderId,
      amount,
      currency,
      key_id: 'rzp_test_mock',
      mock: true,
    });
  }

  try {
    const receipt = `rcpt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const credentials = `${keyId}:${keySecret}`;
    const authHeader = 'Basic ' + (typeof btoa !== 'undefined' ? btoa(credentials) : Buffer.from(credentials).toString('base64'));

    const orderPayload = {
      amount,
      currency,
      receipt,
      notes: {
        product: 'wacpad_pro_lifetime',
        email: customerEmail || 'not_provided',
        name: customerName || 'not_provided',
      },
    };

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Razorpay Order Creation Failed]:', data);
      const statusCode = response.status === 401 ? 401 : 500;
      return res.status(statusCode).json({
        error: data.error?.description || 'Failed to create Razorpay order',
      });
    }

    return res.status(200).json({
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      key_id: keyId,
    });
  } catch (err) {
    console.error('[Razorpay Order Error]:', err);
    return res.status(500).json({ error: 'Internal server error creating order', details: err.message });
  }
}
