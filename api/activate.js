/**
 * @file api/activate.js
 * @description Device activation endpoint enforcing 3-seat hardware limit.
 * Cross-references Stripe purchases to defeat forged keys and uses atomic
 * Redis Lua scripts to eliminate activation race conditions.
 */

import crypto from 'crypto';
import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { verifyLicenseKey } from '../lib/licensing.js';

export const MAX_SEATS = 3;

// Atomic Redis Lua Script: Handles seat registration safely under concurrency
export const ATOMIC_ACTIVATE_SCRIPT = `
local key = KEYS[1]
local machine_id = ARGV[1]
local machine_data = ARGV[2]
local max_seats = tonumber(ARGV[3])

-- 1. Check if machine is already registered on this license
if redis.call('HEXISTS', key, machine_id) == 1 then
  redis.call('HSET', key, machine_id, machine_data)
  local count = redis.call('HLEN', key)
  return { 1, count, "already_registered" }
end

-- 2. Check seat capacity
local count = redis.call('HLEN', key)
if count >= max_seats then
  return { 0, count, "limit_reached" }
end

-- 3. Register new seat
redis.call('HSET', key, machine_id, machine_data)
local new_count = redis.call('HLEN', key)
return { 1, new_count, "newly_activated" }
`;

/**
 * Validates whether an email has a completed purchase in Stripe.
 *
 * @param {Stripe} stripe - Stripe SDK instance
 * @param {string} email - Customer email
 * @returns {Promise<boolean>}
 */
export async function verifyStripePurchase(stripe, email) {
  try {
    // 1. Search customers
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data && customers.data.length > 0) {
      const customerId = customers.data[0].id;
      const charges = await stripe.charges.list({ customer: customerId, limit: 5 });
      if (charges.data.some((c) => c.status === 'succeeded' && !c.refunded)) {
        return true;
      }
    }

    // 2. Search charges directly by billing email
    const charges = await stripe.charges.list({ limit: 20 });
    const matched = charges.data?.find(
      (c) =>
        c.billing_details?.email?.toLowerCase() === email &&
        c.status === 'succeeded' &&
        !c.refunded
    );
    return !!matched;
  } catch (err) {
    console.error('[Stripe Purchase Verification Error]', err);
    return false;
  }
}

/**
 * Mints an offline activation token signed with the server-only secret.
 *
 * @param {object} payload - Activation payload
 * @param {string} secret - ACTIVATION_TOKEN_SECRET
 * @returns {string} WPACT-<base64> token
 */
export function mintActivationToken(payload, secret) {
  const jsonStr = JSON.stringify(payload);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  hmac.update(jsonBytes);
  const sig = hmac.digest();
  return `WPACT-${Buffer.concat([jsonBytes, sig]).toString('base64')}`;
}

/**
 * Verifies an offline activation token signature and payload.
 *
 * @param {string} token - WPACT-<base64> token
 * @param {string} secret - ACTIVATION_TOKEN_SECRET
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifyActivationToken(token, secret) {
  const trimmed = (token || '').trim();
  if (!trimmed.startsWith('WPACT-')) {
    return { valid: false, error: "Missing 'WPACT-' prefix" };
  }

  const b64Str = trimmed.slice(6);
  let decoded;
  try {
    decoded = Buffer.from(b64Str, 'base64');
  } catch (err) {
    return { valid: false, error: `Invalid Base64 encoding: ${err.message}` };
  }

  if (decoded.length < 32) {
    return { valid: false, error: 'Token payload is too short' };
  }

  const payloadBytes = decoded.subarray(0, decoded.length - 32);
  const sigBytes = decoded.subarray(decoded.length - 32);

  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  hmac.update(payloadBytes);
  const expectedSig = hmac.digest();

  if (!crypto.timingSafeEqual(sigBytes, expectedSig)) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  try {
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: `Corrupt token JSON: ${err.message}` };
  }
}

/**
 * Handles device activation requests enforcing 3-seat hardware limit.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const { license_key, machine_id, os, device_name } = body || {};

  if (!license_key || !machine_id) {
    return res.status(400).json({ error: 'license_key and machine_id are required' });
  }

  // 1. Verify license key format & signature
  const verification = verifyLicenseKey(license_key);
  if (!verification.valid || !verification.payload) {
    return res.status(400).json({ error: verification.error || 'Invalid license key' });
  }

  const email = verification.payload.email.toLowerCase().trim();
  const licenseHash = crypto.createHash('sha256').update(license_key.trim()).digest('hex');

  // 2. Cross-reference Stripe to prevent forged key activation
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const isMockMode = !stripeKey || stripeKey.startsWith('mock_') || stripeKey === 'placeholder';

  if (!isMockMode) {
    const stripe = new Stripe(stripeKey);
    const hasPaid = await verifyStripePurchase(stripe, email);
    if (!hasPaid) {
      return res.status(403).json({
        error: 'No valid purchase record found for this license key in Stripe. Key cannot be activated.',
      });
    }
  }

  // 3. Connect to Upstash Redis
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    // If Redis is not configured in local development, return mock token
    if (process.env.NODE_ENV !== 'production') {
      const mockSecret = process.env.ACTIVATION_TOKEN_SECRET || 'dev-activation-secret-32-chars-long!!';
      const mockToken = mintActivationToken(
        { email, license_hash: licenseHash, machine_id, seat: 1, max_seats: MAX_SEATS, activated_at: Math.floor(Date.now() / 1000) },
        mockSecret
      );
      return res.status(200).json({ success: true, seat: 1, max_seats: MAX_SEATS, token: mockToken });
    }
    return res.status(500).json({ error: 'Activation database unconfigured' });
  }

  const redis = new Redis({ url: redisUrl, token: redisToken });
  const redisKey = `license:${licenseHash}:machines`;
  const machineData = JSON.stringify({
    machine_id,
    device_name: device_name || 'Desktop Workstation',
    os: os || 'Unknown OS',
    activated_at: Math.floor(Date.now() / 1000),
  });

  // 4. Atomic seat registration via Lua script
  let result;
  try {
    result = await redis.eval(
      ATOMIC_ACTIVATE_SCRIPT,
      [redisKey],
      [machine_id, machineData, MAX_SEATS]
    );
  } catch (err) {
    console.error('[Redis Activation Error]', err);
    return res.status(500).json({ error: 'Failed to process activation request' });
  }

  const [granted, seatCount, reason] = result;

  if (granted !== 1) {
    return res.status(403).json({
      error: `Activation limit reached (${seatCount}/${MAX_SEATS} devices). Please deactivate an unused machine at https://wacpad.com/lookup.html to free up a seat.`,
      seats_used: seatCount,
      max_seats: MAX_SEATS,
    });
  }

  // 5. Mint offline activation token
  const tokenSecret = process.env.ACTIVATION_TOKEN_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev-activation-secret-32-chars-long!!' : null);
  if (!tokenSecret) {
    return res.status(500).json({ error: 'Server activation secret missing' });
  }

  const tokenPayload = {
    email,
    license_hash: licenseHash,
    machine_id,
    seat: seatCount,
    max_seats: MAX_SEATS,
    activated_at: Math.floor(Date.now() / 1000),
  };

  const activationToken = mintActivationToken(tokenPayload, tokenSecret);

  return res.status(200).json({
    success: true,
    seat: seatCount,
    max_seats: MAX_SEATS,
    token: activationToken,
    message: reason === 'already_registered' ? 'Device re-activated successfully' : 'Device activated successfully',
  });
}
