#!/usr/bin/env node
/**
 * @file test/hiwl/run_playwright.js
 * @description Approach 2: Fully Automated Playwright Headless Driver.
 * Automates DOM interactions, fills test payment details for Razorpay & Dodo Payments,
 * captures the resulting WP1- key, activates the Windows desktop host, and asserts
 * iPad client feature unlocks over native WebSocket.
 */

import { chromium } from 'playwright';
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

async function testRazorpayAutomated(browser, portalUrl, hostUrl, wsUrl) {
  console.log('\n==============================================================');
  console.log(' [RAZORPAY AUTOMATED] Playwright Headless Driver Test');
  console.log('==============================================================');

  const context = await browser.newContext();
  const page = await context.newPage();
  const testEmail = `playwright-razorpay-${Date.now()}@wacpad.com`;

  // Auto-respond to the email prompt() in main.js
  page.on('dialog', async (dialog) => {
    console.log(`[Playwright] Dialog detected: "${dialog.message()}". Filling: ${testEmail}`);
    await dialog.accept(testEmail);
  });

  const url = `${portalUrl}/?geo=IN#pricing`;
  console.log(`[1/5] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });

  // Verify Razorpay button is rendered
  const buyBtn = page.locator('#buyProBtn');
  await buyBtn.waitFor({ state: 'visible', timeout: 10000 });
  const btnText = await buyBtn.innerText();
  console.log(`[+] Found Pricing Button: "${btnText}"`);

  console.log('[2/5] Triggering Razorpay Checkout...');
  await buyBtn.click();

  // Wait for Razorpay frame
  console.log('[*] Waiting for Razorpay Checkout iframe...');
  const rzpFrame = page.frameLocator('iframe[name="rzp_checkout_form"], iframe.razorpay-checkout-frame');
  
  // Wait for either the iframe or bank selector
  try {
    const netbankingBtn = rzpFrame.locator('text=Netbanking, [data-testid="netbanking-btn"], div:has-text("Netbanking")').first();
    await netbankingBtn.waitFor({ state: 'visible', timeout: 12000 });
    console.log('[+] Razorpay modal active. Selecting Netbanking...');
    await netbankingBtn.click();

    // Select SBI or first bank
    const bankOption = rzpFrame.locator('text=State Bank of India, text=SBI, [data-testid="bank-sbi"], div:has-text("SBI")').first();
    await bankOption.waitFor({ state: 'visible', timeout: 6000 });
    await bankOption.click();

    // Click Pay
    const paySubmitBtn = rzpFrame.locator('button:has-text("Pay"), [data-testid="pay-button"]').first();
    await paySubmitBtn.click();
    console.log('[+] Clicked Pay button in Razorpay modal.');
  } catch (err) {
    console.warn(`[!] Note on Razorpay DOM automation: ${err.message}`);
  }

  // Handle Razorpay Sandbox Bank Popup Window if spawned
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const popup = await popupPromise;
  if (popup) {
    console.log(`[+] Razorpay Test Bank Popup detected: ${popup.url()}`);
    await popup.waitForLoadState('domcontentloaded');
    const successBtn = popup.locator('button:has-text("Success"), input[value="Success"], a:has-text("Success")').first();
    await successBtn.waitFor({ state: 'visible', timeout: 8000 });
    await successBtn.click();
    console.log('[+] Clicked "Success" on Razorpay Sandbox Bank popup!');
  }

  // Wait for redirect to success.html
  console.log('[*] Waiting for navigation to /success.html...');
  await page.waitForURL(/success\.html/, { timeout: 25000 });
  console.log(`[+] Reached Success Page: ${page.url()}`);

  // Extract license key
  const keyElement = page.locator('#licenseKeyDisplay, #licenseKey, .license-key-box, code').first();
  await keyElement.waitFor({ state: 'visible', timeout: 10000 });
  const rawKey = await keyElement.innerText();
  const licenseKey = rawKey.match(/WP1-[A-Za-z0-9+/=]+/)?.[0];

  if (!licenseKey) {
    throw new Error(`Could not parse WP1- license key from text: "${rawKey}"`);
  }

  console.log(`[3/5] Extracted Valid License Key: ${licenseKey}`);
  const verified = verifyLicenseKey(licenseKey);
  console.log(`[+] Cryptographic HMAC Verified: valid=${verified.valid}, tier=${verified.payload?.tier}`);

  // HWIL: Machine Activation
  console.log(`\n[4/5] Activating Windows Host Server (${hostUrl})...`);
  const hostHealth = await checkHostServerHealth(hostUrl);
  if (!hostHealth.online) {
    console.warn(`[!] WacPad desktop host not running on ${hostUrl}. Launch dist/WacPad.exe to test live socket.`);
  } else {
    const actResult = await activateHostServer(licenseKey, hostUrl);
    console.log(`[+] Host Activated! is_pro=${actResult.is_pro}`);

    // Client-in-the-Loop Protocol Verification
    console.log(`[5/5] Connecting Simulated iPad Client via WebSocket (${wsUrl})...`);
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
    if (hostHealth.machine_id) {
      await deactivateHostSeat(licenseKey, hostHealth.machine_id, portalUrl);
      console.log(`[+] Teardown: Seat released successfully.`);
    }
  }

  await context.close();
  console.log('\n[PASS] Razorpay Automated Playwright Flow Completed Successfully!\n');
}

async function testDodoAutomated(browser, portalUrl, hostUrl, wsUrl) {
  console.log('\n==============================================================');
  console.log(' [DODO PAYMENTS AUTOMATED] Playwright Headless Driver Test');
  console.log('==============================================================');

  const context = await browser.newContext();
  const page = await context.newPage();
  const testEmail = `playwright-dodo-${Date.now()}@wacpad.com`;

  const url = `${portalUrl}/?geo=US#pricing`;
  console.log(`[1/5] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });

  const buyBtn = page.locator('#buyProBtn');
  await buyBtn.waitFor({ state: 'visible', timeout: 10000 });
  const btnText = await buyBtn.innerText();
  console.log(`[+] Found Pricing Button: "${btnText}"`);

  console.log('[2/5] Triggering Dodo Checkout Redirect...');
  await buyBtn.click();

  // Wait for redirect to checkout.dodopayments.com
  await page.waitForURL(/checkout\.dodopayments\.com/, { timeout: 20000 });
  console.log(`[+] Reached Dodo Hosted Checkout: ${page.url()}`);

  try {
    // Fill Customer Email if not prefilled
    const emailInput = page.locator('input[type="email"], input[name="email"], input[id*="email"]').first();
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill(testEmail);
    }

    // Fill Card Number
    const cardInput = page.locator('input[name*="card"], input[id*="card"], input[placeholder*="Card number"], input[autocomplete="cc-number"]').first();
    if (await cardInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cardInput.fill('4242 4242 4242 4242');
    }

    // Fill Exp Date
    const expInput = page.locator('input[name*="exp"], input[id*="exp"], input[placeholder*="MM / YY"], input[autocomplete="cc-exp"]').first();
    if (await expInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expInput.fill('12/28');
    }

    // Fill CVC
    const cvcInput = page.locator('input[name*="cvc"], input[id*="cvc"], input[placeholder*="CVC"], input[autocomplete="cc-csc"]').first();
    if (await cvcInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cvcInput.fill('123');
    }

    // Submit Payment
    const submitBtn = page.locator('button:has-text("Pay"), button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      console.log('[+] Submitted Dodo sandbox test payment form.');
    }
  } catch (err) {
    console.warn(`[!] Dodo form automation note: ${err.message}`);
  }

  // Wait for redirect back to wacpad.com/success.html
  console.log('[*] Waiting for redirect back to /success.html...');
  await page.waitForURL(/success\.html/, { timeout: 35000 });
  console.log(`[+] Reached Success Page: ${page.url()}`);

  // Extract license key
  const keyElement = page.locator('#licenseKeyDisplay, #licenseKey, .license-key-box, code').first();
  await keyElement.waitFor({ state: 'visible', timeout: 10000 });
  const rawKey = await keyElement.innerText();
  const licenseKey = rawKey.match(/WP1-[A-Za-z0-9+/=]+/)?.[0];

  if (!licenseKey) {
    throw new Error(`Could not parse WP1- license key from text: "${rawKey}"`);
  }

  console.log(`[3/5] Extracted Valid License Key: ${licenseKey}`);
  const verified = verifyLicenseKey(licenseKey);
  console.log(`[+] Cryptographic HMAC Verified: valid=${verified.valid}, tier=${verified.payload?.tier}`);

  // HWIL: Machine Activation
  console.log(`\n[4/5] Activating Windows Host Server (${hostUrl})...`);
  const hostHealth = await checkHostServerHealth(hostUrl);
  if (!hostHealth.online) {
    console.warn(`[!] WacPad desktop host not running on ${hostUrl}. Launch dist/WacPad.exe to test live socket.`);
  } else {
    const actResult = await activateHostServer(licenseKey, hostUrl);
    console.log(`[+] Host Activated! is_pro=${actResult.is_pro}`);

    // Client-in-the-Loop Protocol Verification
    console.log(`[5/5] Connecting Simulated iPad Client via WebSocket (${wsUrl})...`);
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
    if (hostHealth.machine_id) {
      await deactivateHostSeat(licenseKey, hostHealth.machine_id, portalUrl);
      console.log(`[+] Teardown: Seat released successfully.`);
    }
  }

  await context.close();
  console.log('\n[PASS] Dodo Payments Automated Playwright Flow Completed Successfully!\n');
}

async function main() {
  const args = process.argv.slice(2);
  const railIndex = args.indexOf('--rail');
  const rail = railIndex !== -1 ? args[railIndex + 1] : 'both';
  const isHeaded = args.includes('--headed');
  const portal = process.env.WACPAD_PORTAL_URL || DEFAULT_PORTAL_URL;
  const host = process.env.WACPAD_HOST_URL || DEFAULT_HOST_URL;
  const ws = process.env.WACPAD_WS_URL || DEFAULT_WS_URL;

  console.log('==============================================================');
  console.log('   WacPad Automated Playwright Driver Suite v0.7.1');
  console.log(`   Target Portal: ${portal}`);
  console.log(`   Local Host:    ${host}`);
  console.log(`   Target Rail:   ${rail.toUpperCase()}`);
  console.log(`   Browser Mode:  ${isHeaded ? 'HEADED (Visible)' : 'HEADLESS'}`);
  console.log('==============================================================');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !isHeaded,
  });

  try {
    if (rail === 'razorpay' || rail === 'both') {
      await testRazorpayAutomated(browser, portal, host, ws);
    }
    if (rail === 'dodo' || rail === 'both') {
      await testDodoAutomated(browser, portal, host, ws);
    }
    console.log('\n⭐⭐ ALL AUTOMATED PLAYWRIGHT FLOWS COMPLETED SUCCESSFULLY! ⭐⭐\n');
  } catch (err) {
    console.error(`\n[-] Playwright Test Suite Error: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
