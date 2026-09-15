# WacPad Website & Payment System 🖊️💳

Minimal, modern landing page, Stripe checkout system, and cryptographic HMAC-SHA256 license key generator for **WacPad Pro**.

Designed for **100% Zero-Cost Hosting** with zero monthly recurring infrastructure fees.

---

## 🏗️ Architecture & Zero-Cost Breakdown

| Component | Provider / Tool | Monthly Fixed Cost | Usage Limits |
| :--- | :--- | :--- | :--- |
| **Edge Hosting & CDN** | **Vercel** / **Cloudflare Pages** | **$0.00** | 100,000 requests/day, unlimited bandwidth, free custom domain SSL |
| **Payment Gateway** | **Stripe Checkout** | **$0.00** | $0/mo setup. Pay-as-you-go per sale (2.9% + $0.30) |
| **Automated Invoices** | **Stripe Billing / Receipts** | **$0.00** | Built-in free PDF invoices and receipts delivered by Stripe |
| **Cryptographic Licensing** | **Embedded Node.js Webhook** | **$0.00** | Generates offline `WP1-<Base64>` HMAC-SHA256 keys on serverless edge |
| **Transactional Email** | **Resend** (Optional) | **$0.00** | 3,000 free emails/month |
| **Download Distribution** | **GitHub Releases** | **$0.00** | Free unlimited public release artifact hosting |

---

## 📂 Project Structure

```
website/
├── api/
│   ├── create-checkout-session.js  # Initiates Stripe Checkout for $14.99 Lifetime
│   ├── get-license.js              # Verifies payment session and retrieves WP1- key
│   ├── webhook.js                  # Stripe webhook listener (checkout.session.completed)
│   └── lookup-license.js           # Self-service license recovery by customer email
├── lib/
│   ├── licensing.js                # HMAC-SHA256 WP1 generator & verifier (matches Rust bit-for-bit)
│   └── email.js                    # Resend email dispatcher with local mock fallback
├── public/
│   ├── index.html                  # Dark-mode landing page + GitHub download + Pro pricing card
│   ├── success.html                # Celebration page with 1-click license copy & activation guide
│   ├── cancel.html                 # Payment cancellation page
│   ├── lookup.html                 # Self-service license key recovery portal
│   ├── css/styles.css              # Sleek dark-mode design system
│   └── js/
│       ├── main.js                 # Landing page interactions & checkout redirect
│       └── success.js              # License key loader & clipboard copy
├── test/
│   └── licensing.test.js           # Cryptographic test suite matching Rust test_licensing.rs
├── server.js                       # Standalone zero-dependency local dev server
├── vercel.json                     # Vercel serverless deployment config
└── package.json
```

---

## ⚡ Quick Start (Local Testing with Zero Setup)

You can run and test the complete purchase and licensing flow locally without needing live Stripe credentials:

```bash
cd website
npm install
npm run dev
```

Open your browser to:
- **Landing Page:** [http://localhost:3000](http://localhost:3000)
- **Instant Test Checkout:** Clicking **Buy Pro Lifetime License** will automatically trigger the built-in mock checkout mode.
- **Success Page:** [http://localhost:3000/success.html?session_id=mock_demo&mock=true](http://localhost:3000/success.html?session_id=mock_demo&mock=true) (Displays a real, cryptographically valid `WP1-...` key that validates in WacPad Desktop!).
- **License Recovery:** [http://localhost:3000/lookup.html](http://localhost:3000/lookup.html)

To verify cross-compatibility with the Rust engine:
```bash
npm test
# In the root WacPad repository:
cargo test -p wacpad-core --test test_licensing
```

---

## 🚀 Going Live: Zero-Cost Deployment to Vercel

### Step 1: Obtain Stripe Keys
1. Create a free account at [https://stripe.com](https://stripe.com).
2. Under **Developers** &rarr; **API Keys**, copy your:
   - `Publishable key` (`pk_live_...` or `pk_test_...`)
   - `Secret key` (`sk_live_...` or `sk_test_...`)
3. Under **Developers** &rarr; **Webhooks**, add an endpoint:
   - Endpoint URL: `https://your-domain.vercel.app/api/webhook`
   - Events to listen for: `checkout.session.completed`
   - Copy the `Signing secret` (`whsec_...`).

### Step 2: (Optional) Transactional Email with Resend
1. Sign up for a free account at [https://resend.com](https://resend.com) (3,000 emails/month free).
2. Generate an API key (`re_...`) and add your sending domain.
*(Note: If you skip this, users still see their license key immediately on the `/success.html` page after payment, and Stripe sends them an official payment receipt).*

### Step 3: Deploy to Vercel (100% Free)
Deploy via the Vercel CLI or Vercel Dashboard:

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# From the website/ directory:
vercel
```

In the Vercel Project Settings &rarr; **Environment Variables**, add:
- `STRIPE_SECRET_KEY`: `sk_live_...`
- `STRIPE_WEBHOOK_SECRET`: `whsec_...`
- `WACPAD_LICENSE_SECRET`: `wacpad-license-key-v1-secret` (or your custom secret matching `licensing.rs`)
- `RESEND_API_KEY`: `re_...` (optional)
- `EMAIL_FROM`: `WacPad Pro <licensing@yourdomain.com>`

---

## 🔒 How Cryptographic Licensing Works End-to-End

1. **Customer Buys Pro ($14.99 Lifetime):**
   - Customer clicks **Buy Pro** on the website.
   - Redirected to Stripe Checkout (Apple Pay, Google Pay, or Credit/Debit Card).
2. **Instant License Generation:**
   - Stripe redirects customer to `/success.html?session_id={CHECKOUT_SESSION_ID}`.
   - The `/api/get-license` function verifies payment with Stripe and generates an HMAC-SHA256 signed payload:
     ```json
     {
       "email": "customer@example.com",
       "tier": "ProLifetime",
       "issued_at": 1773550000,
       "expires_at": null
     }
     ```
   - Appends the 32-byte HMAC-SHA256 signature, encodes as Base64, and returns `WP1-<Base64>`.
3. **One-Click Activation:**
   - The user copies their key and pastes it into **WacPad Desktop** (`Settings` &rarr; `License Status`).
   - WacPad Desktop validates the signature offline instantly and saves it to local app storage (`license.key`).
4. **iPad Unlocked Automatically:**
   - When the iPad connects to WacPad Desktop via Direct USB or Wi-Fi, the desktop server broadcasts `is_pro: true` in the initial handshake.
   - The iPad app immediately removes the top ad bar and unlocks the full canvas with no session limits!
