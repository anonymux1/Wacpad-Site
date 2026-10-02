import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  saveLicenseMappingD1,
  getLicenseByEmailD1,
  getLicenseByCustomerIdD1,
  registerDeviceD1,
  deactivateDeviceD1,
  listDevicesD1,
} from '../lib/db.js';
import { onRequest } from '../functions/api/[[route]].js';

/**
 * Creates an in-memory mock of the Cloudflare D1 SQL Database API.
 */
function createMockD1() {
  const licensesTable = new Map(); // email -> record
  const devicesTable = new Map();  // `${licenseHash}:${machineId}` -> record

  return {
    prepare(sql) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      let boundParams = [];

      const statement = {
        bind(...params) {
          boundParams = params;
          return statement;
        },
        async run() {
          if (normalizedSql.startsWith('INSERT INTO licenses')) {
            const [email, license_key, customer_id, session_id, tier, created_at] = boundParams;
            licensesTable.set(email, { email, license_key, customer_id, session_id, tier, created_at });
            return { success: true };
          }
          if (normalizedSql.startsWith('INSERT INTO devices')) {
            const [license_hash, machine_id, device_name, os, activated_at] = boundParams;
            devicesTable.set(`${license_hash}:${machine_id}`, {
              license_hash,
              machine_id,
              device_name,
              os,
              activated_at,
            });
            return { success: true };
          }
          if (normalizedSql.startsWith('UPDATE devices')) {
            const [device_name, os, activated_at, license_hash, machine_id] = boundParams;
            const key = `${license_hash}:${machine_id}`;
            const existing = devicesTable.get(key);
            if (existing) {
              devicesTable.set(key, { ...existing, device_name, os, activated_at });
            }
            return { success: true };
          }
          if (normalizedSql.startsWith('DELETE FROM devices')) {
            const [license_hash, machine_id] = boundParams;
            devicesTable.delete(`${license_hash}:${machine_id}`);
            return { success: true };
          }
          return { success: true };
        },
        async first() {
          if (normalizedSql.includes('FROM licenses WHERE email = ?')) {
            const [email] = boundParams;
            return licensesTable.get(email) || null;
          }
          if (normalizedSql.includes('FROM licenses WHERE customer_id = ?')) {
            const [customerId] = boundParams;
            for (const record of licensesTable.values()) {
              if (record.customer_id === customerId) return record;
            }
            return null;
          }
          if (normalizedSql.includes('SELECT machine_id FROM devices WHERE license_hash = ? AND machine_id = ?')) {
            const [license_hash, machine_id] = boundParams;
            return devicesTable.get(`${license_hash}:${machine_id}`) || null;
          }
          if (normalizedSql.includes('SELECT COUNT(*) as count FROM devices WHERE license_hash = ?')) {
            const [license_hash] = boundParams;
            let count = 0;
            for (const record of devicesTable.values()) {
              if (record.license_hash === license_hash) count++;
            }
            return { count };
          }
          return null;
        },
        async all() {
          if (normalizedSql.includes('FROM devices WHERE license_hash = ?')) {
            const [license_hash] = boundParams;
            const results = [];
            for (const record of devicesTable.values()) {
              if (record.license_hash === license_hash) {
                results.push({
                  machine_id: record.machine_id,
                  device_name: record.device_name,
                  os: record.os,
                  activated_at: record.activated_at,
                });
              }
            }
            return { results };
          }
          return { results: [] };
        },
      };

      return statement;
    },
  };
}

describe('Cloudflare Native D1 SQL Database & Pages Functions Gateway', () => {
  const testEmail = 'artist@wacpad.io';
  const testKey = 'WP1-eyJlbWFpbCI6ImFydGlzdEB3YWNwYWQuaW8iLCJ0aWVyIjoiUHJvTGlmZXRpbWUiLCJpc3N1ZWRfYXQiOjE3MDAwMDAwMDB9';
  const testHash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
  const dev1 = 'machine-alpha-001';
  const dev2 = 'machine-beta-002';
  const dev3 = 'machine-gamma-003';
  const dev4 = 'machine-delta-004';

  it('1. saveLicenseMappingD1 stores license record in D1', async () => {
    const d1 = createMockD1();
    const res = await saveLicenseMappingD1(d1, {
      email: testEmail,
      licenseKey: testKey,
      customerId: 'cus_12345',
      sessionId: 'cs_67890',
      tier: 'ProLifetime',
      createdAt: 1700000000,
    });

    assert.equal(res.success, true);
    assert.equal(res.record.email, testEmail);

    const retrieved = await getLicenseByEmailD1(d1, testEmail);
    assert.ok(retrieved);
    assert.equal(retrieved.licenseKey, testKey);
    assert.equal(retrieved.customerId, 'cus_12345');

    const byCustomer = await getLicenseByCustomerIdD1(d1, 'cus_12345');
    assert.ok(byCustomer);
    assert.equal(byCustomer.email, testEmail);
  });

  it('2. registerDeviceD1 registers new seats up to max 3', async () => {
    const d1 = createMockD1();

    // Seat 1
    const r1 = await registerDeviceD1(d1, testHash, dev1, 'MacBook Pro', 'macOS', 3);
    assert.equal(r1.granted, true);
    assert.equal(r1.seatCount, 1);
    assert.equal(r1.reason, 'newly_activated');

    // Seat 2
    const r2 = await registerDeviceD1(d1, testHash, dev2, 'Windows PC', 'Windows', 3);
    assert.equal(r2.granted, true);
    assert.equal(r2.seatCount, 2);

    // Seat 3
    const r3 = await registerDeviceD1(d1, testHash, dev3, 'Studio PC', 'Windows', 3);
    assert.equal(r3.granted, true);
    assert.equal(r3.seatCount, 3);

    // Seat 4 (Should be rejected)
    const r4 = await registerDeviceD1(d1, testHash, dev4, 'Tablet PC', 'Windows', 3);
    assert.equal(r4.granted, false);
    assert.equal(r4.seatCount, 3);
    assert.equal(r4.reason, 'limit_reached');
  });

  it('3. registerDeviceD1 updates existing machine without taking an extra seat', async () => {
    const d1 = createMockD1();

    await registerDeviceD1(d1, testHash, dev1, 'MacBook', 'macOS', 3);
    const rUpdate = await registerDeviceD1(d1, testHash, dev1, 'MacBook M3 Max', 'macOS 15', 3);

    assert.equal(rUpdate.granted, true);
    assert.equal(rUpdate.seatCount, 1);
    assert.equal(rUpdate.reason, 'already_registered');
  });

  it('4. listDevicesD1 and deactivateDeviceD1 manage seats correctly', async () => {
    const d1 = createMockD1();

    await registerDeviceD1(d1, testHash, dev1, 'Workstation 1', 'Windows', 3);
    await registerDeviceD1(d1, testHash, dev2, 'Workstation 2', 'Windows', 3);

    const devices = await listDevicesD1(d1, testHash);
    assert.equal(devices.length, 2);

    const deact = await deactivateDeviceD1(d1, testHash, dev1);
    assert.equal(deact.success, true);
    assert.equal(deact.seatsUsed, 1);

    const remaining = await listDevicesD1(d1, testHash);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].machine_id, dev2);
  });

  it('5. Cloudflare Pages Functions Gateway routes /api/* correctly', async () => {
    const d1 = createMockD1();
    const env = { DB: d1, NODE_ENV: 'test' };

    // Test unknown route returns 404
    const unknownReq = new Request('https://wacpad.com/api/unknown-endpoint', { method: 'GET' });
    const unknownRes = await onRequest({ request: unknownReq, env, params: { route: ['unknown-endpoint'] } });
    assert.equal(unknownRes.status, 404);

    // Test OPTIONS preflight returns 204
    const optReq = new Request('https://wacpad.com/api/activate', { method: 'OPTIONS' });
    const optRes = await onRequest({ request: optReq, env, params: { route: ['activate'] } });
    assert.equal(optRes.status, 204);

    // Test GET /api/activate returns 405 (method not allowed)
    const getReq = new Request('https://wacpad.com/api/activate', { method: 'GET' });
    const getRes = await onRequest({ request: getReq, env, params: { route: ['activate'] } });
    assert.equal(getRes.status, 405);
  });

  it('6. Cloudflare Pages Functions Gateway resolves "wacpad binding" to env.DB', async () => {
    const d1 = createMockD1();
    const env = { 'wacpad binding': d1, NODE_ENV: 'test' };

    const getReq = new Request('https://wacpad.com/api/activate', { method: 'GET' });
    const getRes = await onRequest({ request: getReq, env, params: { route: ['activate'] } });

    assert.equal(getRes.status, 405);
    assert.equal(env.DB, d1);
  });
});
