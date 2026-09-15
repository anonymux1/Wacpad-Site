import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml } from '../lib/email.js';
import createCheckoutSessionHandler from '../api/create-checkout-session.js';
import getLicenseHandler from '../api/get-license.js';
import lookupLicenseHandler from '../api/lookup-license.js';
import { createMockReq, createMockRes, withEnvAsync } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..');
const TEST_PORT = 3895;

let serverProcess;

/**
 * Helper to make HTTP requests against the test server.
 * Handles ECONNRESET gracefully when server forcefully destroys oversized sockets.
 */
function makeRequest({
  port = TEST_PORT,
  method = 'GET',
  path = '/',
  headers = {},
  body = null,
} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => {
          resBody += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: resBody,
            connectionReset: false,
          });
        });
      }
    );
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        resolve({
          statusCode: 413,
          headers: {},
          body: 'Payload Too Large (Connection Reset)',
          connectionReset: true,
        });
      } else {
        reject(err);
      }
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}


describe('Security: HTML Escaping & Injection Prevention', () => {
  it('1. HTML escaping: import escapeHtml from email.js and test it escapes <script>', () => {
    assert.equal(typeof escapeHtml, 'function', 'escapeHtml must be exported from email.js');
    const input = '<script>alert("xss")</script>';
    const output = escapeHtml(input);
    assert.ok(!output.includes('<script>'), 'Must not contain raw <script>');
    assert.ok(output.includes('&lt;script&gt;'));
  });

  it('2. HTML escaping: escapes double quotes (") to prevent attribute breakout', () => {
    const input = 'hello "world"';
    const output = escapeHtml(input);
    assert.ok(!output.includes('"'));
    assert.ok(output.includes('&quot;'));
  });

  it('3. HTML escaping: escapes single quotes (\') to prevent attribute breakout', () => {
    const input = "it's dangerous";
    const output = escapeHtml(input);
    assert.ok(!output.includes("'"));
    assert.ok(output.includes('&#39;'));
  });

  it('4. HTML escaping: escapes ampersands (&) and angle brackets (< >)', () => {
    const input = 'WacPad & <Friends> > 0';
    const output = escapeHtml(input);
    assert.ok(!output.includes('& '));
    assert.ok(!output.includes('<'));
    assert.ok(!output.includes('>'));
    assert.ok(output.includes('&amp;'));
    assert.ok(output.includes('&lt;Friends&gt;'));
  });

  it('5. HTML escaping: handles null and undefined safely without throwing', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

describe('Security: Production Mode Enforcement', () => {
  it('6. Mock mode blocked: create-checkout-session blocks mock mode in production', async () => {
    await withEnvAsync({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        body: { email: 'prod-user@wacpad.io' },
      });
      const res = createMockRes();
      await createCheckoutSessionHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden when mock mode invoked in production, got ${res.statusCode}`
      );
    });
  });

  it('7. Mock mode blocked: get-license blocks mock mode in production', async () => {
    await withEnvAsync({ NODE_ENV: 'production' }, async () => {
      const req = createMockReq({
        method: 'GET',
        query: { session_id: 'mock_session_prod', mock: 'true' },
      });
      const res = createMockRes();
      await getLicenseHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden for mock get-license in production, got ${res.statusCode}`
      );
    });
  });

  it('8. Mock mode blocked: lookup-license blocks mock mode in production', async () => {
    await withEnvAsync({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.20.0.8' },
        body: { email: 'prod-lookup@wacpad.io' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Expected 403 Forbidden for mock lookup in production, got ${res.statusCode}`
      );
    });
  });
});

describe('Security: Email Validation & Injection Defense in Lookup', () => {
  it('9. Email validation: rejects empty email string', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.9' },
      body: { email: '' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('10. Email validation: rejects email missing @ symbol', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.10' },
      body: { email: 'artist-without-at-sign.com' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('11. Stripe injection: email containing \' OR status:\'succeeded should not bypass validation', async () => {
    // Malicious payload attempting SQL-like injection into Stripe search query
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.11' },
      body: { email: "artist@wacpad.io' OR status:'succeeded" },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);
    assert.equal(
      res.statusCode,
      400,
      `Expected 400 Bad Request for malicious Stripe search query injection, got ${res.statusCode}`
    );
  });

  it('12. Email validation: rejects newline / CRLF injection in email address', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.12' },
      body: { email: 'artist@wacpad.io\r\nBcc: victim@example.com' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('13. Email validation: rejects HTML / script tags embedded in email address', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.13' },
      body: { email: '<script>alert(1)</script>@domain.com' },
    });
    const res = createMockRes();
    await lookupLicenseHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('14. Information disclosure: lookup-license response does NOT contain licenseKey field', async () => {
    await withEnvAsync({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined }, async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { 'x-forwarded-for': '10.20.0.14' },
        body: { email: 'safe-user@wacpad.io' },
      });
      const res = createMockRes();
      await lookupLicenseHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.strictEqual(
        res.body?.licenseKey,
        undefined,
        'License key must never be returned in lookup API response body (email delivery only)'
      );
    });
  });
});

describe('Security: Server-Level Controls (HTTP Server Required)', () => {
  before(async () => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: websiteDir,
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 2000);
      serverProcess.stdout.on('data', (d) => {
        if (d.toString().includes('running on')) {
          clearTimeout(timer);
          resolve();
        }
      });
      serverProcess.on('error', reject);
    });
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  it('15. Path traversal: server rejects /../../../etc/passwd', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/../../../../../../etc/passwd',
    });
    assert.notEqual(
      res.statusCode,
      200,
      `Server must not return 200 for traversal to /etc/passwd (got ${res.statusCode})`
    );
    assert.ok(
      !res.body.includes('root:'),
      'Response body must not contain contents of /etc/passwd'
    );
  });

  it('16. Path traversal: server rejects encoded traversal attempts (/..%2F..%2Fserver.js)', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/..%2F..%2Fserver.js',
    });
    assert.notEqual(
      res.statusCode,
      200,
      `Server must not return 200 for encoded traversal (got ${res.statusCode})`
    );
    assert.ok(
      !res.body.includes('dotenv.config'),
      'Response body must not contain source code of server.js'
    );
  });

  it('17. Rate limiting in lookup: verify 6th request returns 429', async () => {
    const clientIp = '198.51.100.77';

    // Send 5 rapid requests from the same client IP
    for (let i = 0; i < 5; i++) {
      await makeRequest({
        port: TEST_PORT,
        method: 'POST',
        path: '/api/lookup-license',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': clientIp,
        },
        body: JSON.stringify({ email: 'ratelimit@wacpad.io' }),
      });
    }

    // 6th request must be throttled with HTTP 429 Too Many Requests
    const res6 = await makeRequest({
      port: TEST_PORT,
      method: 'POST',
      path: '/api/lookup-license',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': clientIp,
      },
      body: JSON.stringify({ email: 'ratelimit@wacpad.io' }),
    });

    assert.equal(
      res6.statusCode,
      429,
      `Expected 429 Too Many Requests on 6th rapid lookup request, got ${res6.statusCode}`
    );
  });

  it('18. Body size: large body rejected', async () => {
    // Generate an oversized payload (>100KB limit for JSON API endpoints)
    const largePayload = JSON.stringify({
      email: 'large-payload@wacpad.io',
      padding: 'x'.repeat(150 * 1024),
    });

    const res = await makeRequest({
      port: TEST_PORT,
      method: 'POST',
      path: '/api/lookup-license',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(largePayload),
        'x-forwarded-for': '10.30.0.18',
      },
      body: largePayload,
    });

    assert.ok(
      res.statusCode === 413 || res.connectionReset === true,
      `Expected 413 Payload Too Large or TCP connection reset, got status ${res.statusCode}`
    );
  });

  it('19. Path traversal: server rejects URL-encoded dots (/%2e%2e%2f%2e%2e%2fserver.js)', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/%2e%2e%2f%2e%2e%2fserver.js',
    });
    assert.equal(res.statusCode, 403, `Expected 403 Forbidden for encoded dot traversal, got ${res.statusCode}`);
    assert.ok(!res.body.includes('dotenv.config'));
  });

  it('20. Path traversal: server rejects double-encoded traversal (/%252e%252e%252fserver.js)', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/%252e%252e%252fserver.js',
    });
    assert.equal(res.statusCode, 403, `Expected 403 Forbidden for double-encoded traversal, got ${res.statusCode}`);
    assert.ok(!res.body.includes('dotenv.config'));
  });

  it('21. Security: server rejects null byte injection in static path', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/index.html%00.png',
    });
    assert.equal(res.statusCode, 400, `Expected 400 Bad Request for null byte in path, got ${res.statusCode}`);
  });

  it('22. Security headers: server returns standard security headers on responses', async () => {
    const res = await makeRequest({
      port: TEST_PORT,
      path: '/',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });
});
