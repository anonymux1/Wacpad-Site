/**
 * @file api/devices.js
 * @description Lists active devices registered to a WacPad Pro license key.
 */

import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { verifyLicenseKey } from '../lib/licensing.js';

export const MAX_SEATS = 3;

/**
 * Handles device listing for a verified WacPad Pro license.
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

  const { license_key } = body || {};
  if (!license_key) {
    return res.status(400).json({ error: 'license_key is required' });
  }

  const verification = verifyLicenseKey(license_key);
  if (!verification.valid) {
    return res.status(400).json({ error: verification.error || 'Invalid license key' });
  }

  const redisUrl = process.env.UPSTASH_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!redisUrl || !redisToken) {
    if (process.env.NODE_ENV !== 'production') {
      return res.status(200).json({
        success: true,
        devices: [
          {
            machine_id: 'mock-macbook-pro-id-12345678',
            device_name: 'MacBook Pro 16"',
            os: 'macOS',
            activated_at: Math.floor(Date.now() / 1000) - 86400,
          },
        ],
        seats_used: 1,
        max_seats: MAX_SEATS,
      });
    }
    return res.status(500).json({ error: 'Activation database unconfigured' });
  }

  const licenseHash = crypto.createHash('sha256').update(license_key.trim()).digest('hex');
  const redisKey = `license:${licenseHash}:machines`;

  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
  });

  try {
    const allMachines = await redis.hgetall(redisKey);
    const devices = [];
    if (allMachines) {
      for (const [mid, dataStr] of Object.entries(allMachines)) {
        try {
          const parsed = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
          devices.push({
            machine_id: mid,
            device_name: parsed.device_name || 'Desktop Workstation',
            os: parsed.os || 'Unknown OS',
            activated_at: parsed.activated_at || null,
          });
        } catch {
          devices.push({
            machine_id: mid,
            device_name: 'Desktop Workstation',
            os: 'Unknown OS',
            activated_at: null,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      devices,
      seats_used: devices.length,
      max_seats: MAX_SEATS,
    });
  } catch (err) {
    console.error('[Redis Devices Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve active devices' });
  }
}
