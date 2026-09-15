import Stripe from 'stripe';

/**
 * Creates a Stripe Checkout Session for WacPad Pro Lifetime License.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const isInvalidKey = !secretKey || secretKey.startsWith('mock_') || secretKey === 'placeholder';

  // Production guard: mock mode is strictly prohibited in production
  if (process.env.NODE_ENV === 'production' && isInvalidKey) {
    return res.status(403).json({ error: 'Payment service not configured' });
  }

  // Retrieve optional email from query or body
  let customerEmail = null;
  if (req.query?.email) {
    customerEmail = req.query.email;
  } else if (req.body && typeof req.body === 'object' && req.body.email) {
    customerEmail = req.body.email;
  }

  // Local / Test simulation fallback if STRIPE_SECRET_KEY is absent
  if (isInvalidKey) {
    console.warn('[Checkout] STRIPE_SECRET_KEY not set. Generating mock checkout session for testing.');
    const mockId = 'mock_sess_' + Math.random().toString(36).substring(2, 10);
    const mockEmail = encodeURIComponent(customerEmail || 'demo-artist@wacpad.io');
    const redirectUrl = `${baseUrl}/success.html?session_id=${mockId}&mock=true&email=${mockEmail}`;
    return res.status(200).json({ url: redirectUrl, mock: true });
  }

  const stripe = new Stripe(secretKey);

  try {
    const isLiveKey = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');
    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      invoice_creation: {
        enabled: true, // Automatically generate free Stripe PDF invoice & receipt
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'WacPad Pro — Lifetime License',
              description: 'Zero ads, full-canvas drawing surface, unlimited continuous drawing sessions, and lifetime updates.',
            },
            unit_amount: 1499, // $14.99 USD in cents
          },
          quantity: 1,
        },
      ],
      customer_email: customerEmail || undefined,
      allow_promotion_codes: true,
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      metadata: {
        product: 'wacpad_pro_lifetime',
      },
    };

    // automatic_tax only works in live mode or when tax registration is completed
    if (isLiveKey) {
      sessionParams.automatic_tax = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Checkout Error]', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
