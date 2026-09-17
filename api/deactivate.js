/**
 * @file api/deactivate.js
 * @description Removes a machine_id from the active registry for a given license.
 */

import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { verifyLicenseKey } from '../lib/licensing.js';
import { devMockMachines } from '../lib/db.js';

/**
 * Handles deactivating a device seat for a verified WacPad Pro license.
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

  const { license_key, machine_id } = body || {};
  if (!license_key || !machine_id) {
    return res.status(400).json({ error: 'license_key and machine_id required' });
  }

  const verification = verifyLicenseKey(license_key);
  if (!verification.valid) {
    return res.status(400).json({ error: verification.error || 'Invalid license key' });
  }

  const redisUrl = process.env.UPSTASH_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  const licenseHash = crypto.createHash('sha256').update(license_key.trim()).digest('hex');
  const redisKey = `license:${licenseHash}:machines`;

  if (!redisUrl || !redisToken) {
    if (process.env.NODE_ENV !== 'production') {
      const machines = devMockMachines.get(redisKey);
      if (machines) {
        machines.delete(machine_id);
      }
      const remaining = machines ? machines.size : 0;
      return res.status(200).json({
        success: true,
        message: 'Device successfully deactivated',
        seats_used: remaining,
      });
    }
    return res.status(500).json({ error: 'Activation database unconfigured' });
  }

  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
  });

  try {
    await redis.hdel(redisKey, machine_id);
    const remaining = await redis.hlen(redisKey);

    return res.status(200).json({
      success: true,
      message: 'Device successfully deactivated',
      seats_used: remaining,
    });
  } catch (err) {
    console.error('[Redis Deactivation Error]', err);
    return res.status(500).json({ error: 'Failed to process deactivation request' });
  }
}
