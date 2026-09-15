/**
 * Email delivery module for WacPad Pro license keys.
 * Supports Resend (free tier: 3,000 emails/mo) or falls back to console logging.
 */

/**
 * Escapes special HTML characters to prevent XSS injection.
 * Escapes &, <, >, ", and '.
 *
 * @param {*} str - Input string or value to sanitize
 * @returns {string} Sanitized string safe for HTML interpolation
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendLicenseEmail({
  email,
  customerName,
  licenseKey,
  receiptUrl,
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'WacPad <licensing@wacpad.com>';

  const subject = 'Your WacPad Pro Lifetime License Key 🖊️';
  const displayName = escapeHtml(customerName || 'WacPad Creator');
  const safeReceiptUrl = receiptUrl ? escapeHtml(receiptUrl) : null;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #07090e; color: #f1f5f9; padding: 24px; }
    .container { max-width: 580px; margin: 0 auto; background-color: #0f131d; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; }
    .logo { font-size: 24px; font-weight: bold; color: #38bdf8; margin-bottom: 20px; }
    h1 { font-size: 22px; margin-bottom: 12px; color: #ffffff; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.6; }
    .key-box { background-color: #07090e; border: 1px solid #38bdf8; border-radius: 8px; padding: 16px; margin: 24px 0; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; color: #38bdf8; }
    .steps { background-color: #161c2b; border-radius: 8px; padding: 18px; margin: 24px 0; }
    .steps ol { margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.8; }
    .btn { display: inline-block; background-color: #38bdf8; color: #07090e; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 12px; }
    .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">WacPad Pro 🖊️</div>
    <h1>Thank you for your purchase, ${displayName}!</h1>
    <p>Your WacPad Pro Lifetime License is now active. Here is your cryptographic license key:</p>
    
    <div class="key-box">${licenseKey}</div>

    <div class="steps">
      <strong style="color: #ffffff; display: block; margin-bottom: 8px;">How to activate:</strong>
      <ol>
        <li>Open <strong>WacPad Desktop</strong> on your Windows PC or Mac.</li>
        <li>Open the <strong>Settings</strong> tab (gear icon) or click <strong>Upgrade / Enter Key</strong>.</li>
        <li>Paste your license key into the <strong>Enter License Key</strong> field and click <strong>Activate</strong>.</li>
        <li>Your connected iPad will instantly unlock full canvas with no ads and unlimited sessions!</li>
      </ol>
    </div>

    ${safeReceiptUrl ? `<p><a href="${safeReceiptUrl}" style="color: #38bdf8;">View your Stripe Payment Receipt / Invoice</a></p>` : ''}

    <p>Need to download the desktop companion host again? Visit the <a href="https://github.com/anonymux1/WacPad/releases" style="color: #38bdf8;">WacPad Releases Portal</a>.</p>

    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} WacPad. Proprietary Commercial Software. Keep this license key in a safe place.</p>
    </div>
  </div>
</body>
</html>
`;

  if (!apiKey) {
    console.log(`[Email Mock] RESEND_API_KEY not configured. Mock sending email to: ${email}`);
    console.log(`[Email Mock] Subject: ${subject}`);
    console.log(`[Email Mock] Key: ${licenseKey}`);
    return { success: true, simulated: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject,
        html: htmlContent,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[Email Error] Resend API error:', data);
      return { success: false, error: data };
    }

    console.log(`[Email Sent] Successfully delivered license key to ${email}, id: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('[Email Error] Exception sending email via Resend:', error);
    return { success: false, error: error.message };
  }
}
