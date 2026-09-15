import crypto from 'crypto';

export const DEFAULT_LICENSE_SECRET = 'wacpad-license-key-v1-secret';

/**
 * Generates a valid WP1-prefixed license key for a given email and tier.
 * Matches Rust wacpad-core cryptographic HMAC-SHA256 licensing format.
 *
 * @param {string} email - Customer email address
 * @param {string} [tier='ProLifetime'] - License tier ('ProLifetime' | 'ProAnnual')
 * @param {number|null} [expiresAt=null] - Optional Unix timestamp in seconds
 * @param {number|string|null} [issuedAt=null] - Optional Unix timestamp in seconds for deterministic issuance (or secret for backward compatibility)
 * @param {string} [secret] - HMAC secret key
 * @returns {string} WP1-<Base64> formatted license key
 */
export function generateLicenseKey(
  email,
  tier = 'ProLifetime',
  expiresAt = null,
  issuedAt = null,
  secret = process.env.WACPAD_LICENSE_SECRET || DEFAULT_LICENSE_SECRET
) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // Handle backward compatibility if secret was passed as 4th argument
  let resolvedSecret = secret;
  let resolvedIssuedAt = issuedAt;
  if (typeof issuedAt === 'string') {
    resolvedSecret = issuedAt;
    if (typeof secret === 'number') {
      resolvedIssuedAt = secret;
    } else {
      resolvedIssuedAt = null;
    }
  }

  const timestamp = (typeof resolvedIssuedAt === 'number' && Number.isFinite(resolvedIssuedAt))
    ? resolvedIssuedAt
    : Math.floor(Date.now() / 1000);

  const payload = {
    email: normalizedEmail,
    tier,
    issued_at: timestamp,
    expires_at: expiresAt ?? null,
  };

  // Serialize exactly without whitespace, matching serde_json::to_vec
  const jsonStr = JSON.stringify(payload);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');

  // Compute HMAC-SHA256 signature (32 bytes)
  const hmac = crypto.createHmac('sha256', Buffer.from(resolvedSecret, 'utf8'));
  hmac.update(jsonBytes);
  const signatureBytes = hmac.digest();

  // Combine payload JSON bytes + 32-byte signature
  const combined = Buffer.concat([jsonBytes, signatureBytes]);

  // Encode as standard Base64 and prefix with WP1-
  const base64Str = combined.toString('base64');
  return `WP1-${base64Str}`;
}

/**
 * Verifies a WP1 license key.
 *
 * @param {string} key - License key string
 * @param {string} [secret] - HMAC secret key
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifyLicenseKey(
  key,
  secret = process.env.WACPAD_LICENSE_SECRET || DEFAULT_LICENSE_SECRET
) {
  const trimmed = (key || '').trim();
  if (!trimmed.startsWith('WP1-')) {
    return { valid: false, error: "Missing 'WP1-' prefix" };
  }

  const b64Str = trimmed.slice(4);
  let decoded;
  try {
    decoded = Buffer.from(b64Str, 'base64');
  } catch (err) {
    return { valid: false, error: `Invalid Base64 encoding: ${err.message}` };
  }

  if (decoded.length < 32) {
    return { valid: false, error: 'Key payload is too short' };
  }

  const payloadBytes = decoded.subarray(0, decoded.length - 32);
  const sigBytes = decoded.subarray(decoded.length - 32);

  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  hmac.update(payloadBytes);
  const expectedSig = hmac.digest();

  if (!crypto.timingSafeEqual(sigBytes, expectedSig)) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch (err) {
    return { valid: false, error: `Corrupt payload JSON: ${err.message}` };
  }

  if (payload.expires_at) {
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.expires_at) {
      return { valid: false, error: 'License key has expired', payload };
    }
  }

  return { valid: true, payload };
}
