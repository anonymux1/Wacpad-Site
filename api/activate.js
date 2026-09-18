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
import { devMockMachines, getLicenseByEmail } from '../lib/db.js';

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
 * First checks Redis database for an existing issued license mapping.
 * Falls back to searching Stripe customers and charges via the Search API.
 *
 * @param {Stripe} stripe - Stripe SDK instance
 * @param {string} email - Customer email
 * @returns {Promise<boolean>}
 */
export async function verifyStripePurchase(stripe, email) {
  try {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return false;
    }

    // 1. First check the Redis/mock database for the license key (saved during webhook / purchase flow)
    try {
      const existing = await getLicenseByEmail(normalizedEmail);
      if (existing && existing.licenseKey) {
        return true;
      }
    } catch (dbErr) {
      console.warn('[Stripe Purchase Verification] Redis lookup skipped:', dbErr.message);
    }

    if (!stripe) {
      return false;
    }

    // 2. Search Stripe customers by exact email
    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    if (customers.data && customers.data.length > 0) {
      const customerId = customers.data[0].id;
      const charges = await stripe.charges.list({ customer: customerId, limit: 5 });
      if (charges.data.some((c) => c.status === 'succeeded' && !c.refunded)) {
        return true;
      }
    }

    // 3. Fall back to searching charges directly with email query using Stripe Search API (no 20-charge limit)
    if (typeof stripe.charges?.search === 'function') {
      try {
        const sanitizedEmail = normalizedEmail.replace(/['\\]/g, '');
        const searchResult = await stripe.charges.search({
          query: `billing_details.email:\'${sanitizedEmail}\'`,
        });
        if (searchResult?.data?.some((c) => c.status === 'succeeded' && !c.refunded)) {
          return true;
        }
      } catch (searchErr) {
        console.warn('[Stripe Purchase Verification] charges.search error:', searchErr.message);
      }
    }

    return false;
  } catch (err) {
    console.error('[Stripe Purchase Verification Error]', err);
    return false;
  }
}

export const DEFAULT_DEV_PRIVATE_KEY = 'd2b426e25a5c69da785108714243fa911c42809034ee84e19f18e5eb5fac041d';
export const DEFAULT_DEV_PUBLIC_KEY = 'e5caa65d999e35f5db70c227338be28e99774aeb4fccc86194eea484a2e9b781';

/**
 * Parses an Ed25519 private key from a KeyObject, PEM string, or 64-character hex seed.
 */
export function getPrivateKey(input) {
  if (!input) return null;
  try {
    if (typeof input === 'object' && input.type === 'private') return input;
    if (Buffer.isBuffer(input)) {
      if (input.length === 32) {
        const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
        return crypto.createPrivateKey({
          key: Buffer.concat([pkcs8Header, input]),
          format: 'der',
          type: 'pkcs8',
        });
      }
      if (input.length === 48) {
        return crypto.createPrivateKey({
          key: input,
          format: 'der',
          type: 'pkcs8',
        });
      }
      return crypto.createPrivateKey(input);
    }
    const str = String(input).trim();
    if (str.startsWith('-----BEGIN')) return crypto.createPrivateKey(str);
    if (/^[0-9a-fA-F]{64}$/.test(str)) {
      const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
      return crypto.createPrivateKey({
        key: Buffer.concat([pkcs8Header, Buffer.from(str, 'hex')]),
        format: 'der',
        type: 'pkcs8',
      });
    }
    return crypto.createPrivateKey(str);
  } catch {
    return null;
  }
}

/**
 * Parses an Ed25519 public key from a KeyObject, PEM string, or 64-character hex string.
 * If passed a private key, extracts the corresponding public key.
 */
export function getPublicKey(input) {
  if (!input) return null;
  try {
    if (typeof input === 'object' && input.type === 'public') return input;
    if (typeof input === 'object' && input.type === 'private') return crypto.createPublicKey(input);
    if (Buffer.isBuffer(input)) {
      if (input.length === 32) {
        const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        return crypto.createPublicKey({
          key: Buffer.concat([spkiHeader, input]),
          format: 'der',
          type: 'spki',
        });
      }
      if (input.length === 44) {
        return crypto.createPublicKey({
          key: input,
          format: 'der',
          type: 'spki',
        });
      }
      if (input.length === 48) {
        return crypto.createPublicKey(crypto.createPrivateKey({
          key: input,
          format: 'der',
          type: 'pkcs8',
        }));
      }
      return crypto.createPublicKey(input);
    }
    const str = String(input).trim();
    if (str.startsWith('-----BEGIN PRIVATE')) {
      return crypto.createPublicKey(crypto.createPrivateKey(str));
    }
    if (str.startsWith('-----BEGIN')) {
      return crypto.createPublicKey(str);
    }
    if (/^[0-9a-fA-F]{64}$/.test(str)) {
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      return crypto.createPublicKey({
        key: Buffer.concat([spkiHeader, Buffer.from(str, 'hex')]),
        format: 'der',
        type: 'spki',
      });
    }
    return crypto.createPublicKey(str);
  } catch {
    return null;
  }
}

/**
 * Mints an offline activation token signed with the server's Ed25519 private key.
 *
 * @param {object} payload - Activation payload
 * @param {string|crypto.KeyObject} privateKeyInput - Private key (PEM or hex seed)
 * @returns {string} WPACT-<base64> token
 */
export function mintActivationToken(payload, privateKeyInput) {
  const privateKey = getPrivateKey(privateKeyInput);
  if (!privateKey) {
    throw new Error('Invalid private key for token minting');
  }
  const jsonStr = JSON.stringify(payload);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const signature = crypto.sign(null, jsonBytes, privateKey);
  return `WPACT-${Buffer.concat([jsonBytes, signature]).toString('base64')}`;
}

/**
 * Verifies an offline activation token signature using an Ed25519 public key.
 *
 * @param {string} token - WPACT-<base64> token
 * @param {string|crypto.KeyObject} [publicKeyInput] - Public key (defaults to DEFAULT_DEV_PUBLIC_KEY)
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifyActivationToken(token, publicKeyInput = DEFAULT_DEV_PUBLIC_KEY) {
  const publicKey = getPublicKey(publicKeyInput);
  if (!publicKey) {
    return { valid: false, error: 'Invalid public key' };
  }

  const trimmed = (token || '').trim();
  if (!trimmed.startsWith('WPACT-')) {
    return { valid: false, error: "Missing 'WPACT-' prefix" };
  }

  const b64Str = trimmed.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64Str)) {
    return { valid: false, error: 'Invalid Base64 encoding' };
  }

  let decoded;
  try {
    decoded = Buffer.from(b64Str, 'base64');
  } catch (err) {
    return { valid: false, error: `Invalid Base64 encoding: ${err.message}` };
  }

  // Detect legacy HMAC tokens and provide explicit diagnostic error
  if (decoded.length < 65) {
    if (decoded.length >= 32) {
      return {
        valid: false,
        error: 'Incompatible token format (detected legacy HMAC token; Ed25519 signature required)',
      };
    }
    return { valid: false, error: 'Token payload is too short' };
  }

  const payloadBytes = decoded.subarray(0, decoded.length - 64);
  const sigBytes = decoded.subarray(decoded.length - 64);

  const isValid = crypto.verify(null, payloadBytes, publicKey, sigBytes);
  if (!isValid) {
    if (decoded.length >= 32) {
      try {
        const candidatePayload = JSON.parse(decoded.subarray(0, decoded.length - 32).toString('utf8'));
        if (
          candidatePayload &&
          typeof candidatePayload === 'object' &&
          ('license_hash' in candidatePayload || 'machine_id' in candidatePayload)
        ) {
          return {
            valid: false,
            error: 'Incompatible token format (detected legacy HMAC token; Ed25519 signature required)',
          };
        }
      } catch {
        // Not a valid JSON payload from a legacy token
      }
    }
    return { valid: false, error: 'Invalid Ed25519 signature' };
  }

  try {
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { valid: false, error: 'Corrupt token JSON: payload must be a JSON object' };
    }
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

  // 2. Production database configuration guard
  const redisUrl = process.env.UPSTASH_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (process.env.NODE_ENV === 'production' && (!redisUrl || !redisToken)) {
    return res.status(500).json({ error: 'Activation database unconfigured' });
  }

  if (process.env.NODE_ENV === 'production') {
    const configuredKey = (process.env.ACTIVATION_TOKEN_PRIVATE_KEY || '').trim();
    if (!configuredKey || configuredKey === DEFAULT_DEV_PRIVATE_KEY) {
      console.error('[Activation Token Error] Server token signing key configuration error');
      return res.status(500).json({ error: 'Server token signing key configuration error' });
    }
  }

  // 3. Cross-reference Stripe to prevent forged key activation
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const isMockMode = !stripeKey || stripeKey.startsWith('mock_') || stripeKey === 'placeholder';

  if (process.env.NODE_ENV === 'production') {
    if (isMockMode) {
      return res.status(500).json({ error: 'Stripe service unconfigured in production' });
    }
    const stripe = (await import('stripe')).default(stripeKey);
    const hasPaid = await verifyStripePurchase(stripe, email);
    if (!hasPaid) {
      return res.status(403).json({
        error: 'No valid purchase record found for this license key in Stripe. Key cannot be activated.',
      });
    }
  } else if (!isMockMode) {
    const stripe = (await import('stripe')).default(stripeKey);
    const hasPaid = await verifyStripePurchase(stripe, email);
    if (!hasPaid) {
      return res.status(403).json({
        error: 'No valid purchase record found for this license key in Stripe. Key cannot be activated.',
      });
    }
  }

  // 4. Connect to Upstash Redis
  const redisKey = `license:${licenseHash}:machines`;
  const machineData = JSON.stringify({
    machine_id,
    device_name: device_name || 'Desktop Workstation',
    os: os || 'Unknown OS',
    activated_at: Math.floor(Date.now() / 1000),
  });

  let granted;
  let seatCount;
  let reason;

  if (!redisUrl || !redisToken) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Activation database unconfigured' });
    }

    let machines = devMockMachines.get(redisKey);
    if (!machines) {
      machines = new Map();
      devMockMachines.set(redisKey, machines);
    }

    if (machines.has(machine_id)) {
      machines.set(machine_id, machineData);
      granted = 1;
      seatCount = machines.size;
      reason = 'already_registered';
    } else if (machines.size >= MAX_SEATS) {
      granted = 0;
      seatCount = machines.size;
      reason = 'limit_reached';
    } else {
      machines.set(machine_id, machineData);
      granted = 1;
      seatCount = machines.size;
      reason = 'newly_activated';
    }
  } else {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    try {
      const result = await redis.eval(
        ATOMIC_ACTIVATE_SCRIPT,
        [redisKey],
        [machine_id, machineData, MAX_SEATS]
      );
      [granted, seatCount, reason] = result;
    } catch (err) {
      console.error('[Redis Activation Error]', err);
      return res.status(500).json({ error: 'Failed to process activation request' });
    }
  }

  if (granted !== 1) {
    return res.status(403).json({
      error: `Activation limit reached (${seatCount}/${MAX_SEATS} devices). Please deactivate an unused machine at https://wacpad.com/lookup.html to free up a seat.`,
      seats_used: seatCount,
      max_seats: MAX_SEATS,
    });
  }

  // 5. Mint offline activation token using Ed25519 private key
  if (process.env.NODE_ENV === 'production') {
    const configuredKey = (process.env.ACTIVATION_TOKEN_PRIVATE_KEY || '').trim();
    if (!configuredKey || configuredKey === DEFAULT_DEV_PRIVATE_KEY) {
      console.error('[Activation Token Error] Server token signing key configuration error');
      return res.status(500).json({ error: 'Server token signing key configuration error' });
    }
  }

  let privateKey;
  try {
    const rawKey = process.env.ACTIVATION_TOKEN_PRIVATE_KEY || DEFAULT_DEV_PRIVATE_KEY;
    privateKey = getPrivateKey(rawKey);
    if (!privateKey) throw new Error('Key initialization failed');
  } catch (keyErr) {
    // Strict secret hygiene: Never log key content, never serialize internal key errors to client
    console.error('[Activation Token Error] Failed to initialize Ed25519 signing key');
    return res.status(500).json({ error: 'Server token signing key configuration error' });
  }

  const tokenPayload = {
    email,
    license_hash: licenseHash,
    machine_id,
    seat: seatCount,
    max_seats: MAX_SEATS,
    activated_at: Math.floor(Date.now() / 1000),
  };

  let activationToken;
  try {
    activationToken = mintActivationToken(tokenPayload, privateKey);
  } catch (mintErr) {
    console.error('[Activation Token Error] Token signing failed');
    return res.status(500).json({ error: 'Failed to generate activation token' });
  }

  return res.status(200).json({
    success: true,
    seat: seatCount,
    max_seats: MAX_SEATS,
    token: activationToken,
    message: reason === 'already_registered' ? 'Device re-activated successfully' : 'Device activated successfully',
  });
}
