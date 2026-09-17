import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let server;
let PORT;
let BASE;

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', Connection: 'close', ...headers },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function startServer() {
  const net = await import('node:net');
  PORT = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => { resolve(s.address().port); s.close(); });
  });
  BASE = `http://127.0.0.1:${PORT}`;
  process.env.PORT = String(PORT);
  process.env.BASE_URL = BASE;
  process.env.NODE_ENV = 'development';
  // Ensure mock mode (no real Stripe keys)
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  const srvMod = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
  server = srvMod.server;
  if (server && typeof server.unref === 'function') {
    server.unref();
  }
  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('GET', '/');
      if (res.status === 200) break;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
}

describe('Stripe E2E: Full Monetization Lifecycle', async () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const TEST_EMAIL = 'e2e-stripe-test@wacpad.io';
  let licenseKey = null;

  it('1. POST /api/create-checkout-session returns 200 with url', async () => {
    const res = await request('POST', '/api/create-checkout-session', { email: TEST_EMAIL });
    assert.equal(res.status, 200);
    assert.ok(res.body.url, 'Response must contain url field');
    assert.ok(res.body.mock === true, 'Must be in mock mode');
  });

  it('2. POST /api/webhook with checkout.session.completed returns 200', async () => {
    const mockEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_e2e_' + Date.now(),
          customer_details: { email: TEST_EMAIL, name: 'E2E Test Artist' },
          customer_email: TEST_EMAIL,
          customer: 'cus_test_e2e',
          created: Math.floor(Date.now() / 1000),
          metadata: { product: 'wacpad_pro_lifetime' },
        },
      },
    };
    const res = await request('POST', '/api/webhook', mockEvent);
    assert.equal(res.status, 200);
    assert.ok(res.body.received === true);
  });

  it('3. GET /api/get-license returns WP1- key for mock session', async () => {
    const res = await request('GET', `/api/get-license?session_id=mock_demo&mock=true&email=${encodeURIComponent(TEST_EMAIL)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.licenseKey, 'Must return licenseKey');
    assert.ok(res.body.licenseKey.startsWith('WP1-'), 'Key must start with WP1-');
    licenseKey = res.body.licenseKey;
  });

  it('4. POST /api/lookup-license withholds key from HTTP response', async () => {
    const res = await request('POST', '/api/lookup-license', { email: TEST_EMAIL });
    assert.equal(res.status, 200);
    assert.ok(res.body.success === true);
    assert.equal(res.body.licenseKey, undefined, 'licenseKey MUST NOT be in response body');
  });

  it('5. POST /api/activate seat 1 returns 200 with WPACT- token', async () => {
    const res = await request('POST', '/api/activate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-001',
      os: 'Windows 11',
      device_name: 'E2E Test PC 1',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.success);
    assert.equal(res.body.seat, 1);
    assert.equal(res.body.max_seats, 3);
    assert.ok(res.body.token.startsWith('WPACT-'), 'Token must start with WPACT-');
  });

  it('6. POST /api/activate seats 2 and 3 succeed', async () => {
    const res2 = await request('POST', '/api/activate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-002',
      os: 'macOS 14',
      device_name: 'E2E Test Mac',
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.seat, 2);

    const res3 = await request('POST', '/api/activate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-003',
      os: 'Windows 10',
      device_name: 'E2E Test PC 3',
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.body.seat, 3);
  });

  it('7. POST /api/activate seat 4 returns 403 (limit reached)', async () => {
    const res = await request('POST', '/api/activate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-004',
      os: 'Linux',
      device_name: 'E2E Overflow Machine',
    });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('limit'), 'Error must mention limit');
  });

  it('8. POST /api/deactivate frees seat 1', async () => {
    const res = await request('POST', '/api/deactivate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-001',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.success);
  });

  it('9. POST /api/activate seat 4 succeeds after deactivation', async () => {
    const res = await request('POST', '/api/activate', {
      license_key: licenseKey,
      machine_id: 'machine-e2e-004',
      os: 'Linux',
      device_name: 'E2E Reclaimed Machine',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.success);
  });

  it('10. Duplicate webhook returns 200 with duplicate=true', async () => {
    const sessionId = 'cs_test_idempotent_' + Date.now();
    const mockEvent = {
      type: 'checkout.session.completed',
      data: { object: { id: sessionId, customer_email: 'idempotent@wacpad.io', created: Math.floor(Date.now() / 1000) } },
    };
    const res1 = await request('POST', '/api/webhook', mockEvent);
    assert.equal(res1.status, 200);
    const res2 = await request('POST', '/api/webhook', mockEvent);
    assert.equal(res2.status, 200);
    assert.ok(res2.body.duplicate === true, 'Second webhook must be flagged as duplicate');
  });
});
