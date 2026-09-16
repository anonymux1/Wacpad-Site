/**
 * @file lib/db.js
 * @description Centralized Upstash Redis database client and license-to-user mapping store.
 * Maps user email & Stripe customer ID to license keys for recovery, device seat management,
 * and anti-sharing enforcement.
 */

import { Redis } from '@upstash/redis';

/**
 * Resolves the Upstash Redis credentials from supported environment variables.
 * @returns {{ url: string | undefined, token: string | undefined }}
 */
export function getRedisCredentials() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_KV_REST_API_URL ||
    process.env.KV_REST_API_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN;

  return { url, token };
}

/**
 * Initializes and returns an Upstash Redis client instance if credentials exist.
 *
 * @param {object} [customConfig]
 * @returns {Redis | null}
 */
export function getRedisClient(customConfig = null) {
  if (customConfig && customConfig.url && customConfig.token) {
    return new Redis(customConfig);
  }

  const { url, token } = getRedisCredentials();
  if (!url || !token) {
    return null;
  }

  return new Redis({ url, token });
}

/**
 * Persists an email & customer ID mapping to a license key in Upstash Redis.
 *
 * Key Schema:
 *   - `license:by_email:<normalized_email>` -> JSON { licenseKey, email, customerId, sessionId, tier, createdAt }
 *   - `license:by_customer:<customerId>`    -> JSON { licenseKey, email, customerId, sessionId, tier, createdAt }
 *
 * @param {object} params
 * @param {string} params.email - Customer email address
 * @param {string} params.licenseKey - WP1-prefixed cryptographic license key
 * @param {string} [params.customerId] - Stripe customer ID (cus_...)
 * @param {string} [params.sessionId] - Stripe checkout session ID (cs_...)
 * @param {string} [params.tier='ProLifetime'] - License tier
 * @param {number} [params.createdAt] - Creation epoch timestamp in seconds
 * @param {Redis} [client] - Optional Redis instance (for mocking/tests)
 * @returns {Promise<{ success: boolean, record?: object, error?: string }>}
 */
export async function saveLicenseMapping(params, client = null) {
  const redis = client || getRedisClient();
  if (!redis) {
    return { success: false, error: 'Redis client not configured' };
  }

  const email = (params.email || '').trim().toLowerCase();
  const licenseKey = (params.licenseKey || '').trim();

  if (!email) {
    return { success: false, error: 'Email is required' };
  }
  if (!licenseKey) {
    return { success: false, error: 'License key is required' };
  }

  const record = {
    licenseKey,
    email,
    customerId: params.customerId || null,
    sessionId: params.sessionId || null,
    tier: params.tier || 'ProLifetime',
    createdAt: params.createdAt || Math.floor(Date.now() / 1000),
  };

  const recordJson = JSON.stringify(record);

  try {
    // 1. Map by normalized email
    await redis.set(`license:by_email:${email}`, recordJson);

    // 2. Map by customer ID if present
    if (params.customerId) {
      await redis.set(`license:by_customer:${params.customerId}`, recordJson);
    }

    return { success: true, record };
  } catch (err) {
    console.error('[DB Error] Failed to save license mapping:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Looks up a license mapping record by email.
 *
 * @param {string} email - Customer email address
 * @param {Redis} [client] - Optional Redis instance
 * @returns {Promise<object | null>} The license record or null if not found
 */
export async function getLicenseByEmail(email, client = null) {
  const redis = client || getRedisClient();
  if (!redis) {
    return null;
  }

  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  try {
    const data = await redis.get(`license:by_email:${normalized}`);
    if (!data) return null;

    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return { licenseKey: data, email: normalized };
      }
    }
    return data;
  } catch (err) {
    console.error('[DB Error] Failed to get license by email:', err.message);
    return null;
  }
}

/**
 * Looks up a license mapping record by Stripe customer ID.
 *
 * @param {string} customerId - Stripe customer ID
 * @param {Redis} [client] - Optional Redis instance
 * @returns {Promise<object | null>} The license record or null if not found
 */
export async function getLicenseByCustomerId(customerId, client = null) {
  const redis = client || getRedisClient();
  if (!redis) {
    return null;
  }

  if (!customerId) {
    return null;
  }

  try {
    const data = await redis.get(`license:by_customer:${customerId}`);
    if (!data) return null;

    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return { licenseKey: data, customerId };
      }
    }
    return data;
  } catch (err) {
    console.error('[DB Error] Failed to get license by customer ID:', err.message);
    return null;
  }
}
