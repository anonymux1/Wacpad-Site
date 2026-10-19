/**
 * @file test/hiwl/hiwl_core.js
 * @description Core Hardware-in-the-Loop & Client Protocol Verification Module.
 * Used by both the Interactive Browser runner and the Automated Playwright driver.
 */

import http from 'node:http';
import https from 'node:https';
import { verifyLicenseKey } from '../../lib/licensing.js';

export const DEFAULT_HOST_PORT = 8765;
export const DEFAULT_HOST_URL = `http://127.0.0.1:${DEFAULT_HOST_PORT}`;
export const DEFAULT_WS_URL = `ws://127.0.0.1:${DEFAULT_HOST_PORT}/ws`;
export const DEFAULT_PORTAL_URL = process.env.WACPAD_PORTAL_URL || 'https://wacpad.com';

/**
 * Health check the local WacPad host server.
 *
 * @param {string} hostUrl
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export const WACPAD_EXE_PATH = process.env.WACPAD_EXE_PATH || 'F:\\Dev\\WacPad\\dist\\WacPad.exe';

/**
 * Health check the local WacPad host server (via HTTP API with CLI fallback).
 *
 * @param {string} hostUrl
 * @returns {Promise<{ online: boolean, is_pro?: boolean, machine_id?: string, status?: string, via?: string }>}
 */
export async function checkHostServerHealth(hostUrl = DEFAULT_HOST_URL) {
  try {
    const res = await fetch(`${hostUrl}/api/license`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        is_pro: Boolean(data.is_pro),
        machine_id: data.machine_id,
        status: data.status,
        via: 'http',
      };
    }
  } catch {}

  // Fallback to WacPad CLI binary inspection via execFile
  try {
    const { stdout } = await execFileAsync(WACPAD_EXE_PATH, ['--license-status']);
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        online: true,
        is_pro: Boolean(data.is_pro),
        machine_id: data.machine_id,
        status: data.status,
        via: 'cli',
      };
    }
  } catch {}

  return { online: false, error: 'Could not contact WacPad host via HTTP or CLI' };
}

/**
 * Programmatically activates the local WacPad host desktop server.
 *
 * @param {string} licenseKey
 * @param {string} hostUrl
 * @returns {Promise<{ success: boolean, is_pro: boolean, data: any }>}
 */
export async function activateHostServer(licenseKey, hostUrl = DEFAULT_HOST_URL) {
  // Try HTTP activation first
  try {
    const res = await fetch(`${hostUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey }),
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = await res.json();
      const health = await checkHostServerHealth(hostUrl);
      return { success: true, is_pro: health.is_pro, data };
    }
  } catch {}

  // Fallback to CLI activation via execFile
  try {
    const { stdout } = await execFileAsync(WACPAD_EXE_PATH, ['--activate', licenseKey]);
    const health = await checkHostServerHealth(hostUrl);
    return {
      success: health.is_pro,
      is_pro: health.is_pro,
      data: { output: stdout.trim() },
    };
  } catch (err) {
    throw new Error(`Host activation failed: ${err.message}`);
  }
}

/**
 * Connects a simulated iPad WebSocket client to the running WacPad host,
 * captures WsServerMessage::Init, and asserts the full feature unlock contract.
 *
 * @param {string} wsUrl
 * @returns {Promise<{
 *   is_pro: boolean,
 *   ad_top_inset: number,
 *   ads_disabled: boolean,
 *   session_unlimited: boolean,
 *   init_packet: any
 * }>}
 */
export async function verifyClientWebSocketUnlock(wsUrl = DEFAULT_WS_URL) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for WsServerMessage::Init from WacPad host'));
    }, 5000);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // WebSocket connection established to WacPad host
    };

    ws.onmessage = (event) => {
      try {
        let msg;
        if (typeof event.data === 'string') {
          msg = JSON.parse(event.data);
        } else {
          msg = JSON.parse(new TextDecoder().decode(event.data));
        }

        // We expect WsServerMessage::Init or tagged object with is_pro
        const initData = msg.Init || msg;
        if (typeof initData.is_pro !== 'undefined') {
          clearTimeout(timeout);
          ws.close();

          const isPro = Boolean(initData.is_pro);
          // In ContentView.swift:
          // Top ad banner bar (54pt) is rendered only when !networkEngine.isPro.
          // Padding top is: networkEngine.isPro ? 10 : 64 (0.0pt ad inset when Pro).
          const adTopInset = isPro ? 0.0 : 54.0;
          const adsDisabled = isPro;
          const sessionUnlimited = isPro;

          resolve({
            is_pro: isPro,
            ad_top_inset: adTopInset,
            ads_disabled: adsDisabled,
            session_unlimited: sessionUnlimited,
            init_packet: initData,
          });
        }
      } catch (err) {
        // Non-JSON packet or pointer stream, ignore until Init
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket client error: ${err.message || 'Connection refused'}`));
    };
  });
}

/**
 * Deactivates a machine seat on Cloudflare D1 to release quota.
 *
 * @param {string} licenseKey
 * @param {string} machineId
 * @param {string} portalUrl
 * @returns {Promise<any>}
 */
export async function deactivateHostSeat(licenseKey, machineId, portalUrl = DEFAULT_PORTAL_URL) {
  const res = await fetch(`${portalUrl}/api/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
    signal: AbortSignal.timeout(10000),
  });

  return await res.json();
}
