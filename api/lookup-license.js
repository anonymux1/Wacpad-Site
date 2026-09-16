import Stripe from 'stripe';
import { generateLicenseKey } from '../lib/licensing.js';
import { sendLicenseEmail } from '../lib/email.js';
import { getLicenseByEmail, saveLicenseMapping } from '../lib/db.js';

// Module-level rate limiting: max 5 requests per 15 minutes per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 5;

/**
 * Checks if the given IP has exceeded the rate limit.
 *
 * @param {string} ip - Client IP address
 * @returns {boolean} True if rate limited
 */
function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  // Periodic cleanup if the map gets large
  if (rateLimitMap.size > 5000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  record.count += 1;
  return false;
}

/**
 * Handles license recovery lookups safely without exposing purchase existence or keys.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Rate limiting check
  const xff = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : null);
  const clientIp = rawIp ? rawIp.split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown');
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const email = (body?.email || req.query?.email || '').trim().toLowerCase();

  // Strict email format validation (disallows quotes, angle brackets, and control chars)
  const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  // 1. First check Upstash Redis: fast lookup of existing user/email mapping
  try {
    const existingRecord = await getLicenseByEmail(email);
    if (existingRecord && existingRecord.licenseKey) {
      await sendLicenseEmail({
        email,
        customerName: existingRecord.customerName || 'Valued Customer',
        licenseKey: existingRecord.licenseKey,
      });
      return res.status(200).json({
        success: true,
        message: 'If a purchase exists for this email, your license key has been sent.',
      });
    }
  } catch (dbErr) {
    console.warn('[Lookup DB Warning] Upstash lookup skipped:', dbErr.message);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const isMockMode = !secretKey || secretKey.startsWith('mock_') || secretKey === 'placeholder';

  // Production guard
  if (isMockMode) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Payment service not configured' });
    }
    // In local / demo mode: simulate sending email, never return key in HTTP response
    const key = generateLicenseKey(email, 'ProLifetime');
    await saveLicenseMapping({ email, licenseKey: key, tier: 'ProLifetime' }).catch(() => {});
    await sendLicenseEmail({
      email,
      customerName: 'Valued Customer',
      licenseKey: key,
    });
    return res.status(200).json({
      success: true,
      message: 'If a purchase exists for this email, your license key has been sent.',
    });
  }

  const stripe = new Stripe(secretKey);

  try {
    let hasPurchase = false;
    let customerId = null;

    // Exact email match (prevents query injection)
    const customers = await stripe.customers.list({
      email,
      limit: 1,
    });

    if (customers.data && customers.data.length > 0) {
      hasPurchase = true;
      customerId = customers.data[0].id;
    } else {
      // Fallback check on charges
      const charges = await stripe.charges.list({ limit: 10 });
      const matchedCharge = charges.data?.find(
        (charge) =>
          charge.billing_details?.email === email &&
          charge.status === 'succeeded' &&
          !charge.refunded
      );
      if (matchedCharge) {
        hasPurchase = true;
        customerId = matchedCharge.customer || null;
      }
    }

    if (hasPurchase) {
      const licenseKey = generateLicenseKey(email, 'ProLifetime');
      // Persist to Upstash Redis so subsequent lookups are instant
      await saveLicenseMapping({
        email,
        customerId,
        licenseKey,
        tier: 'ProLifetime',
      }).catch(() => {});

      await sendLicenseEmail({
        email,
        customerName: 'Valued Customer',
        licenseKey,
      });
    }

    // NEVER return the license key in the HTTP response.
    // Return identical response whether found or not to prevent account enumeration.
    return res.status(200).json({
      success: true,
      message: 'If a purchase exists for this email, your license key has been sent.',
    });
  } catch (err) {
    console.error('[Lookup Error]', err);
    return res.status(500).json({ error: 'Failed to process license lookup' });
  }
}
