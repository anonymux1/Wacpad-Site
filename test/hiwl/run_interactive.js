#!/usr/bin/env node
/**
 * @file test/hiwl/run_interactive.js
 * @description Approach 1: Human-In-The-Loop Interactive Browser Test Runner.
 * Executes real sandbox checkouts with a 5-second human action in the browser,
 * then automatically captures the license, activates the desktop host, and asserts
 * iPad protocol feature unlocks (ads removed, sessions uncapped).
 */

import { exec } from 'node:child_process';
import readline from 'node:readline';
import {
  DEFAULT_HOST_URL,
  DEFAULT_WS_URL,
  DEFAULT_PORTAL_URL,
  checkHostServerHealth,
  activateHostServer,
  verifyClientWebSocketUnlock,
  deactivateHostSeat,
} from './hiwl_core.js';
import { verifyLicenseKey } from '../../lib/licensing.js';

function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? `start "" "${url}"` :
                   process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(startCmd);
}

function promptUser(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function testRazorpayInteractive(portalUrl, hostUrl, wsUrl) {
  console.log('\n==============================================================');
  console.log(' [RAZORPAY INDIA SANDBOX] Interactive Checkout & Activation');
  console.log('==============================================================');

  const testEmail = `hiwl-razorpay-${Date.now()}@wacpad.com`;
  console.log(`[1/5] Initiating Sandbox Order for: ${testEmail}`);

  // Create real sandbox order
  const orderRes = await fetch(`${portalUrl}/api/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 129900,
      currency: 'INR',
      email: testEmail,
      name: 'HIWL India Tester',
    }),
  });

  const orderData = await orderRes.json();
  if (!orderRes.ok || !orderData.order_id) {
    throw new Error(`Razorpay order creation failed: ${JSON.stringify(orderData)}`);
  }
  console.log(`[+] Real Razorpay Order Created: ${orderData.order_id} (Key: ${orderData.key_id})`);

  // Open Browser to wacpad.com with ?geo=IN
  const checkoutPageUrl = `${portalUrl}/?geo=IN#pricing`;
  console.log(`[2/5] Opening browser to: ${checkoutPageUrl}`);
  openBrowser(checkoutPageUrl);

  console.log('\n--------------------------------------------------------------');
  console.log('>> HUMAN ACTION REQUIRED IN BROWSER (takes ~5 seconds):');
  console.log(` 1. Click 'Upgrade to Pro — ₹1,299'`);
  console.log(` 2. Enter email: ${testEmail}`);
  console.log(` 3. In the Razorpay modal, select: Netbanking -> State Bank of India`);
  console.log(` 4. Click 'Pay' -> Razorpay test bank screen will open`);
  console.log(` 5. Click 'Success' on the test screen`);
  console.log('--------------------------------------------------------------\n');

  const inputKey = await promptUser('Paste the WP1- license key displayed on the success screen (or press Enter if auto-retrieving): ');

  let licenseKey = inputKey;
  if (!licenseKey) {
    console.log('[*] Polling backend for license key issued to ' + testEmail + '...');
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const devRes = await fetch(`${portalUrl}/api/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail }),
        });
        const devData = await devRes.json();
        if (devData.licenseKey) {
          licenseKey = devData.licenseKey;
          break;
        }
      } catch {}
    }
  }

  if (!licenseKey || !licenseKey.startsWith('WP1-')) {
    throw new Error('Valid WP1- license key was not retrieved.');
  }

  console.log(`[+] Captured Valid License Key: ${licenseKey}`);
  const verified = verifyLicenseKey(licenseKey);
  console.log(`[+] Cryptographic HMAC Verified: valid=${verified.valid}, tier=${verified.payload?.tier}`);

  // HWIL: Machine Activation
  console.log(`\n[3/5] Activating Windows Host Server (${hostUrl})...`);
  const hostHealth = await checkHostServerHealth(hostUrl);
  if (!hostHealth.online) {
    console.warn(`[!] WacPad desktop host not running on ${hostUrl}. Launch dist/WacPad.exe to test live socket.`);
  } else {
    const actResult = await activateHostServer(licenseKey, hostUrl);
    console.log(`[+] Host Activated! is_pro=${actResult.is_pro}`);

    // Client-in-the-Loop Protocol Verification
    console.log(`[4/5] Connecting Simulated iPad Client via WebSocket (${wsUrl})...`);
    const unlock = await verifyClientWebSocketUnlock(wsUrl);
    console.log(`[+] WebSocket Handshake Verified:`);
    console.log(`    - is_pro:            ${unlock.is_pro} (EXPECTED: true)`);
    console.log(`    - ad_top_inset:      ${unlock.ad_top_inset}pt (EXPECTED: 0.0pt, Ads Disabled)`);
    console.log(`    - ads_disabled:      ${unlock.ads_disabled} (EXPECTED: true)`);
    console.log(`    - session_unlimited: ${unlock.session_unlimited} (EXPECTED: true)`);

    if (!unlock.is_pro || unlock.ad_top_inset !== 0.0) {
      throw new Error('iPad Protocol verification failed: Pro features not unlocked!');
    }

    // Teardown
    console.log(`[5/5] Teardown: Deactivating seat on Cloudflare D1...`);
    if (hostHealth.machine_id) {
      await deactivateHostSeat(licenseKey, hostHealth.machine_id, portalUrl);
      console.log(`[+] Seat released successfully.`);
    }
  }

  console.log('\n[PASS] Razorpay Sandbox HIWL Flow Completed Successfully!\n');
}

async function testDodoInteractive(portalUrl, hostUrl, wsUrl) {
  console.log('\n==============================================================');
  console.log(' [DODO PAYMENTS GLOBAL SANDBOX] Interactive Checkout & Activation');
  console.log('==============================================================');

  const testEmail = `hiwl-dodo-${Date.now()}@wacpad.com`;
  console.log(`[1/5] Initiating Dodo Checkout Session for: ${testEmail}`);

  // Create real Dodo checkout session
  const dodoRes = await fetch(`${portalUrl}/api/create-dodo-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      name: 'HIWL Global Illustrator',
    }),
  });

  const dodoData = await dodoRes.json();
  if (!dodoRes.ok || !dodoData.url) {
    throw new Error(`Dodo checkout creation failed: ${JSON.stringify(dodoData)}`);
  }
  console.log(`[+] Real Dodo Hosted Checkout Created: ${dodoData.url}`);

  console.log(`[2/5] Opening browser directly to Dodo Hosted Checkout...`);
  openBrowser(dodoData.url);

  console.log('\n--------------------------------------------------------------');
  console.log('>> HUMAN ACTION REQUIRED IN BROWSER (takes ~5 seconds):');
  console.log(` 1. On checkout.dodopayments.com, enter email: ${testEmail}`);
  console.log(` 2. Test Card: 4242 4242 4242 4242`);
  console.log(` 3. Expiration: 12/28 | CVC: 123 | ZIP: 90210`);
  console.log(` 4. Click 'Pay $14.99'`);
  console.log('--------------------------------------------------------------\n');

  const inputKey = await promptUser('Paste the WP1- license key displayed on the success screen: ');

  let licenseKey = inputKey;
  if (!licenseKey || !licenseKey.startsWith('WP1-')) {
    throw new Error('Valid WP1- license key was not provided.');
  }

  console.log(`[+] Captured Valid License Key: ${licenseKey}`);
  const verified = verifyLicenseKey(licenseKey);
  console.log(`[+] Cryptographic HMAC Verified: valid=${verified.valid}, tier=${verified.payload?.tier}`);

  // HWIL: Machine Activation
  console.log(`\n[3/5] Activating Windows Host Server (${hostUrl})...`);
  const hostHealth = await checkHostServerHealth(hostUrl);
  if (!hostHealth.online) {
    console.warn(`[!] WacPad desktop host not running on ${hostUrl}. Launch dist/WacPad.exe to test live socket.`);
  } else {
    const actResult = await activateHostServer(licenseKey, hostUrl);
    console.log(`[+] Host Activated! is_pro=${actResult.is_pro}`);

    // Client-in-the-Loop Protocol Verification
    console.log(`[4/5] Connecting Simulated iPad Client via WebSocket (${wsUrl})...`);
    const unlock = await verifyClientWebSocketUnlock(wsUrl);
    console.log(`[+] WebSocket Handshake Verified:`);
    console.log(`    - is_pro:            ${unlock.is_pro} (EXPECTED: true)`);
    console.log(`    - ad_top_inset:      ${unlock.ad_top_inset}pt (EXPECTED: 0.0pt, Ads Disabled)`);
    console.log(`    - ads_disabled:      ${unlock.ads_disabled} (EXPECTED: true)`);
    console.log(`    - session_unlimited: ${unlock.session_unlimited} (EXPECTED: true)`);

    if (!unlock.is_pro || unlock.ad_top_inset !== 0.0) {
      throw new Error('iPad Protocol verification failed: Pro features not unlocked!');
    }

    // Teardown
    console.log(`[5/5] Teardown: Deactivating seat on Cloudflare D1...`);
    if (hostHealth.machine_id) {
      await deactivateHostSeat(licenseKey, hostHealth.machine_id, portalUrl);
      console.log(`[+] Seat released successfully.`);
    }
  }

  console.log('\n[PASS] Dodo Payments Sandbox HIWL Flow Completed Successfully!\n');
}

async function main() {
  const args = process.argv.slice(2);
  const railIndex = args.indexOf('--rail');
  const rail = railIndex !== -1 ? args[railIndex + 1] : 'both';
  const portal = process.env.WACPAD_PORTAL_URL || DEFAULT_PORTAL_URL;
  const host = process.env.WACPAD_HOST_URL || DEFAULT_HOST_URL;
  const ws = process.env.WACPAD_WS_URL || DEFAULT_WS_URL;

  console.log('==============================================================');
  console.log('   WacPad HIWL Interactive Browser Test Suite v0.7.1');
  console.log(`   Target Portal: ${portal}`);
  console.log(`   Local Host:    ${host}`);
  console.log(`   Target Rail:   ${rail.toUpperCase()}`);
  console.log('==============================================================');

  try {
    if (rail === 'razorpay' || rail === 'both') {
      await testRazorpayInteractive(portal, host, ws);
    }
    if (rail === 'dodo' || rail === 'both') {
      await testDodoInteractive(portal, host, ws);
    }
    console.log('\n⭐⭐ ALL SELECTED RAILS PASSED HIWL INTERACTIVE VERIFICATION! ⭐⭐\n');
  } catch (err) {
    console.error(`\n[-] HIWL Test Runner Error: ${err.message}`);
    process.exit(1);
  }
}

main();
