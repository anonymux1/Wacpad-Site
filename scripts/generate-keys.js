#!/usr/bin/env node
/**
 * scripts/generate-keys.js
 * Generates an Ed25519 keypair for offline device activation tokens.
 *
 * Usage:
 *   npm run gen:keys
 */
import crypto from 'crypto';
import assert from 'assert';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// PKCS#8 DER for Ed25519 is 48 bytes: 16-byte ASN.1 header + 32-byte raw private seed
const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
const privRaw = privDer.subarray(16);
const privHex = privRaw.toString('hex');

// SPKI DER for Ed25519 is 44 bytes: 12-byte ASN.1 header + 32-byte raw public key
const pubDer = publicKey.export({ type: 'spki', format: 'der' });
const pubRaw = pubDer.subarray(12);
const pubHex = pubRaw.toString('hex');

// Assert invariant lengths
assert.ok(
  privDer.length === 48 && privRaw.length === 32,
  `Private key length invariant failed: DER=${privDer.length}, raw=${privRaw.length}`
);
assert.ok(
  pubDer.length === 44 && pubRaw.length === 32,
  `Public key length invariant failed: DER=${pubDer.length}, raw=${pubRaw.length}`
);

// Cryptographic self-test: sign and verify a test message using the generated keypair
const testMessage = Buffer.from('wacpad-key-generation-selftest', 'utf8');
const testSignature = crypto.sign(null, testMessage, privateKey);
const isValid = crypto.verify(null, testMessage, publicKey, testSignature);
assert.equal(isValid, true, 'Cryptographic self-test failed: signature verification failed');

// Format Rust byte array [0x..., 0x..., ...] formatted into 2 lines of 16 bytes
const rustBytes = Array.from(pubRaw)
  .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
  .reduce((rows, byte, idx) => {
    if (idx % 16 === 0) rows.push([byte]);
    else rows[rows.length - 1].push(byte);
    return rows;
  }, [])
  .map((row) => `    ${row.join(', ')},`)
  .join('\n');

console.log('================================================================');
console.log('       WacPad Ed25519 Activation Token Keypair Generator       ');
console.log('================================================================\n');

console.log('--- 1. Private Key (Server .env: ACTIVATION_TOKEN_PRIVATE_KEY) ---');
console.log(`ACTIVATION_TOKEN_PRIVATE_KEY=${privHex}\n`);

console.log('--- 2. Public Key (Hex representation) ---');
console.log(`Public Key Hex: ${pubHex}\n`);

console.log('--- 3. Public Key Rust Array (crates/wacpad-core/src/licensing.rs) ---');
console.log('pub const ACTIVATION_PUBLIC_KEY: [u8; 32] = [');
console.log(rustBytes);
console.log('];\n');

console.log('----------------------------------------------------------------');
console.log('SECURITY WARNING:');
console.log('Keep ACTIVATION_TOKEN_PRIVATE_KEY strictly confidential!');
console.log('Store in production .env / Vercel secrets. NEVER commit to git.');
console.log('NEVER distribute the private key with the client desktop binary.');
console.log('================================================================\n');
