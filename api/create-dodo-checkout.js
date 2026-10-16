/**
 * Creates a Dodo Payments Checkout Session for WacPad Pro Lifetime License.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.DODO_PAYMENTS_API_KEY;
  const productId = process.env.DODO_PRODUCT_ID || 'pdt_0NpqdjR6faKYqLtCgr6Ma';
  const isLive = process.env.DODO_ENV === 'live_mode' || apiKey?.startsWith('dodo_live_');
  const dodoHost = isLive ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';

  const forwardedHost = req.headers?.['x-forwarded-host'] || req.headers?.host;
  const forwardedProto = req.headers?.['x-forwarded-proto'] || 'https';
  const inferredOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  const baseUrl = process.env.BASE_URL || req.headers?.origin || inferredOrigin || 'https://wacpad.com';

  const body = req.body || {};
  const customerEmail = body.email || req.query?.email || null;

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Dodo Payments not configured' });
    }
    console.warn('[Dodo] API key not configured. Returning mock redirect for testing.');
    const mockSession = 'cks_mock_' + Math.random().toString(36).substring(2, 10);
    return res.status(200).json({
      url: `${baseUrl}/success.html?session_id=${mockSession}&mock=true&provider=dodo`,
      session_id: mockSession,
      mock: true,
    });
  }

  try {
    const payload = {
      product_cart: [
        { product_id: productId, "quantity": 1 }
      ],
      return_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&provider=dodo`,
    };

    if (customerEmail) {
      payload.customer = { email: customerEmail };
    }

    const response = await fetch(`${dodoHost}/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Dodo Checkout Error]:', data);
      return res.status(response.status).json({
        error: data.message || 'Failed to initialize Dodo checkout session',
      });
    }

    return res.status(200).json({
      url: data.checkout_url,
      session_id: data.session_id,
    });
  } catch (err) {
    console.error('[Dodo API Exception]:', err);
    return res.status(500).json({ error: 'Internal server error initializing Dodo checkout' });
  }
}
