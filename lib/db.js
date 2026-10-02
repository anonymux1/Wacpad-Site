/**
 * @file lib/db.js
 * @description Centralized database client supporting Cloudflare D1 SQL database
 * and Upstash Redis. Maps user email & Stripe customer ID to license keys for recovery,
 * device seat management, and anti-sharing enforcement.
 */

import { Redis } from '@upstash/redis';

/**
 * In-memory device registry for local development and testing when external databases are unconfigured.
 * Maps redisKey (`license:<hash>:machines`) -> Map<machine_id, machine_data_json>
 */
export const devMockMachines = new Map();

/**
 * In-memory license registry for local development and testing.
 * Maps email / customerId -> license record JSON
 */
export const devMockLicenses = new Map();

// ==============================================================================
// 1. Cloudflare D1 SQL Database Operations (100% Native Cloudflare)
// ==============================================================================

/**
 * Saves a license mapping to Cloudflare D1.
 *
 * @param {object} d1 - Cloudflare D1 database binding (env.DB)
 * @param {object} params
 * @param {string} params.email - Customer email address
 * @param {string} params.licenseKey - WP1-prefixed cryptographic license key
 * @param {string} [params.customerId] - Stripe customer ID
 * @param {string} [params.sessionId] - Stripe checkout session ID
 * @param {string} [params.tier='ProLifetime'] - License tier
 * @param {number} [params.createdAt] - Creation epoch timestamp in seconds
 * @returns {Promise<{ success: boolean, record?: object, error?: string }>}
 */
export async function saveLicenseMappingD1(d1, params) {
  if (!d1) {
    return { success: false, error: 'D1 database binding not provided' };
  }

  const email = (params.email || '').trim().toLowerCase();
  const licenseKey = (params.licenseKey || '').trim();

  if (!email || !licenseKey) {
    return { success: false, error: 'Email and licenseKey are required' };
  }

  const customerId = params.customerId || null;
  const sessionId = params.sessionId || null;
  const tier = params.tier || 'ProLifetime';
  const createdAt = params.createdAt || Math.floor(Date.now() / 1000);

  const record = { email, licenseKey, customerId, sessionId, tier, createdAt };

  try {
    await d1
      .prepare(
        `INSERT INTO licenses (email, license_key, customer_id, session_id, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           license_key = excluded.license_key,
           customer_id = coalesce(excluded.customer_id, licenses.customer_id),
           session_id = coalesce(excluded.session_id, licenses.session_id),
           tier = excluded.tier,
           created_at = excluded.created_at`
      )
      .bind(email, licenseKey, customerId, sessionId, tier, createdAt)
      .run();

    return { success: true, record };
  } catch (err) {
    console.error('[D1 Error] Failed to save license mapping:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Looks up a license record by email in Cloudflare D1.
 *
 * @param {object} d1 - Cloudflare D1 database binding
 * @param {string} email
 * @returns {Promise<object | null>}
 */
export async function getLicenseByEmailD1(d1, email) {
  if (!d1) return null;
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return null;

  try {
    const row = await d1
      .prepare(
        'SELECT email, license_key, customer_id, session_id, tier, created_at FROM licenses WHERE email = ?'
      )
      .bind(normalized)
      .first();

    if (!row) return null;
    return {
      email: row.email,
      licenseKey: row.license_key,
      customerId: row.customer_id,
      sessionId: row.session_id,
      tier: row.tier,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('[D1 Error] Failed to get license by email:', err.message);
    return null;
  }
}

/**
 * Looks up a license record by Stripe customer ID in Cloudflare D1.
 *
 * @param {object} d1 - Cloudflare D1 database binding
 * @param {string} customerId
 * @returns {Promise<object | null>}
 */
export async function getLicenseByCustomerIdD1(d1, customerId) {
  if (!d1 || !customerId) return null;

  try {
    const row = await d1
      .prepare(
        'SELECT email, license_key, customer_id, session_id, tier, created_at FROM licenses WHERE customer_id = ?'
      )
      .bind(customerId)
      .first();

    if (!row) return null;
    return {
      email: row.email,
      licenseKey: row.license_key,
      customerId: row.customer_id,
      sessionId: row.session_id,
      tier: row.tier,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('[D1 Error] Failed to get license by customer ID:', err.message);
    return null;
  }
}

/**
 * Registers or updates a device seat in Cloudflare D1 enforcing maximum seats.
 *
 * @param {object} d1 - Cloudflare D1 database binding
 * @param {string} licenseHash - SHA-256 hash of license key
 * @param {string} machineId - Machine hardware fingerprint
 * @param {string} [deviceName='Desktop Workstation']
 * @param {string} [os='Unknown OS']
 * @param {number} [maxSeats=3]
 * @returns {Promise<{ granted: boolean, seatCount?: number, reason?: string, error?: string }>}
 */
export async function registerDeviceD1(d1, licenseHash, machineId, deviceName = 'Desktop Workstation', os = 'Unknown OS', maxSeats = 3) {
  if (!d1) return { granted: false, error: 'D1 database not provided' };

  try {
    // 1. Check if device is already registered on this license
    const existing = await d1
      .prepare('SELECT machine_id FROM devices WHERE license_hash = ? AND machine_id = ?')
      .bind(licenseHash, machineId)
      .first();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      await d1
        .prepare('UPDATE devices SET device_name = ?, os = ?, activated_at = ? WHERE license_hash = ? AND machine_id = ?')
        .bind(deviceName, os, now, licenseHash, machineId)
        .run();

      const countRow = await d1
        .prepare('SELECT COUNT(*) as count FROM devices WHERE license_hash = ?')
        .bind(licenseHash)
        .first();

      return { granted: true, seatCount: countRow?.count || 1, reason: 'already_registered' };
    }

    // 2. Check seat capacity
    const countRow = await d1
      .prepare('SELECT COUNT(*) as count FROM devices WHERE license_hash = ?')
      .bind(licenseHash)
      .first();

    const currentCount = Number(countRow?.count || 0);
    if (currentCount >= maxSeats) {
      return { granted: false, seatCount: currentCount, reason: 'limit_reached' };
    }

    // 3. Register new seat
    await d1
      .prepare('INSERT INTO devices (license_hash, machine_id, device_name, os, activated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(licenseHash, machineId, deviceName, os, now)
      .run();

    return { granted: true, seatCount: currentCount + 1, reason: 'newly_activated' };
  } catch (err) {
    console.error('[D1 Device Registration Error]', err);
    return { granted: false, error: err.message };
  }
}

/**
 * Deactivates a device seat in Cloudflare D1.
 *
 * @param {object} d1 - Cloudflare D1 database binding
 * @param {string} licenseHash
 * @param {string} machineId
 * @returns {Promise<{ success: boolean, seatsUsed: number, error?: string }>}
 */
export async function deactivateDeviceD1(d1, licenseHash, machineId) {
  if (!d1) return { success: false, error: 'D1 database not provided' };

  try {
    await d1
      .prepare('DELETE FROM devices WHERE license_hash = ? AND machine_id = ?')
      .bind(licenseHash, machineId)
      .run();

    const countRow = await d1
      .prepare('SELECT COUNT(*) as count FROM devices WHERE license_hash = ?')
      .bind(licenseHash)
      .first();

    return { success: true, seatsUsed: Number(countRow?.count || 0) };
  } catch (err) {
    console.error('[D1 Deactivate Error]', err);
    return { success: false, error: err.message, seatsUsed: 0 };
  }
}

/**
 * Lists all active devices registered to a license in Cloudflare D1.
 *
 * @param {object} d1 - Cloudflare D1 database binding
 * @param {string} licenseHash
 * @returns {Promise<Array<{ machine_id: string, device_name: string, os: string, activated_at: number }>>}
 */
export async function listDevicesD1(d1, licenseHash) {
  if (!d1) return [];

  try {
    const { results } = await d1
      .prepare('SELECT machine_id, device_name, os, activated_at FROM devices WHERE license_hash = ? ORDER BY activated_at DESC')
      .bind(licenseHash)
      .all();

    return results || [];
  } catch (err) {
    console.error('[D1 List Devices Error]', err);
    return [];
  }
}

// ==============================================================================
// 2. Upstash Redis & Dev Mock Fallback Operations
// ==============================================================================

/**
 * Resolves Upstash Redis credentials from environment variables.
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
 * Persists an email & customer ID mapping to a license key.
 * Supports Redis, or falls back to in-memory store in dev/test.
 *
 * @param {object} params
 * @param {Redis} [client] - Optional Redis instance
 * @returns {Promise<{ success: boolean, record?: object, error?: string }>}
 */
export async function saveLicenseMapping(params, client = null) {
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

  const redis = client || getRedisClient();
  if (!redis) {
    // In-memory fallback for local dev / tests
    devMockLicenses.set(`license:by_email:${email}`, record);
    if (params.customerId) {
      devMockLicenses.set(`license:by_customer:${params.customerId}`, record);
    }
    return { success: true, record };
  }

  const recordJson = JSON.stringify(record);

  try {
    await redis.set(`license:by_email:${email}`, recordJson);
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
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return null;

  const redis = client || getRedisClient();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    return devMockLicenses.get(`license:by_email:${normalized}`) || null;
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
  if (!customerId) return null;

  const redis = client || getRedisClient();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    return devMockLicenses.get(`license:by_customer:${customerId}`) || null;
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
