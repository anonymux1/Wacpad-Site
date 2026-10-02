# WacPad Website & Payment System 🖊️💳

Minimal, modern landing page, Stripe checkout system, cryptographic HMAC-SHA256 license key generator, and Ed25519 offline activation token service for **WacPad Pro**.

Designed for **100% Zero-Cost Hosting on Cloudflare** with zero monthly recurring infrastructure fees.

---

## 🏗️ Architecture & Zero-Cost Cloudflare Breakdown

| Component | Provider / Tool | Monthly Fixed Cost | Usage Limits |
| :--- | :--- | :--- | :--- |
| **Edge Hosting & CDN** | **Cloudflare Pages** | **$0.00** | Unlimited bandwidth, global edge CDN, free custom domain SSL |
| **Serverless API** | **Cloudflare Pages Functions** | **$0.00** | 100,000 requests/day, sub-10ms global edge execution |
| **Database & Seats** | **Cloudflare D1 SQL Database** | **$0.00** | 5,000,000 reads/day, 100,000 writes/day, 5 GB storage |
| **Payment Gateway** | **Stripe Checkout** | **$0.00** | $0/mo setup. Pay-as-you-go per sale (2.9% + $0.30) |
| **Inbound Email** | **Cloudflare Email Routing** | **$0.00** | Free custom address routing to personal inbox (`support@wacpad.com`) |
| **Outbound Email** | **Resend** (REST API) | **$0.00** | 3,000 free emails/month for purchases & license recovery |
| **Download Distribution** | **GitHub Releases** | **$0.00** | Free unlimited public release artifact hosting |

---

## 📂 Project Structure

```
website/
├── api/                            # Node.js Serverless API Handlers
│   ├── create-checkout-session.js  # Initiates Stripe Checkout for $14.99 Lifetime
│   ├── get-license.js              # Verifies payment session and retrieves WP1- key
│   ├── webhook.js                  # Stripe webhook listener (checkout.session.completed)
│   ├── lookup-license.js           # Self-service license recovery by customer email
│   ├── activate.js                 # 3-seat hardware limit & Ed25519 offline token minting
│   ├── deactivate.js               # Deactivates a machine seat to free up activation slots
│   └── devices.js                  # Lists active devices for a verified license key
├── functions/api/                  # Cloudflare Pages Functions Edge Gateway
│   └── [[route]].js                # Universal adapter routing Cloudflare Fetch to tested API handlers
├── migrations/                     # Cloudflare D1 SQL Schema Migrations
│   └── 0001_initial_schema.sql     # Licenses & devices table schemas with indexes
├── lib/
│   ├── licensing.js                # HMAC-SHA256 WP1 generator & verifier (matches Rust bit-for-bit)
│   ├── db.js                       # Cloudflare D1 SQL database client & local mock store
│   └── email.js                    # Resend email dispatcher (purchases & key recovery)
├── public/                         # Static Assets (served directly by Cloudflare CDN)
│   ├── index.html                  # Dark-mode landing page + GitHub download + Pro pricing card
│   ├── success.html                # Celebration page with 1-click license copy & activation guide
│   ├── cancel.html                 # Payment cancellation page
│   ├── lookup.html                 # Self-service license key recovery portal
│   ├── css/styles.css              # Sleek dark-mode design system
│   └── js/
│       ├── main.js                 # Landing page interactions & checkout redirect
│       └── success.js              # License key loader & clipboard copy
├── test/
│   ├── licensing.test.js           # Cryptographic test suite matching Rust test_licensing.rs
│   ├── api.test.js                 # HTTP endpoints, query params, and mock mode tests
│   ├── activation.test.js          # Hardware seat limits and Ed25519 token tests
│   ├── security.test.js            # XSS escaping, rate limiting, and path traversal tests
│   └── d1.test.js                  # Cloudflare D1 SQL queries and Pages Functions gateway tests
├── server.js                       # Standalone zero-dependency local dev server
├── wrangler.toml                   # Cloudflare Pages & D1 database configuration
└── package.json
```

---

## ⚡ Quick Start (Local Testing with Zero Setup)

You can run and test the complete purchase and licensing flow locally without needing live credentials:

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

To run the automated test suite (110 unit and security tests):
```bash
npm test
```

---

## 🚀 Going Live: 100% Cloudflare Native Deployment

### Step 1: Create Your Cloudflare D1 Database (30 seconds)
1. In the [Cloudflare Dashboard](https://dash.cloudflare.com), navigate to **Storage & Databases** &rarr; **D1 SQL Database**.
2. Click **Create Database**, and name it `wacpad-db`.
3. In the D1 dashboard, click **Console** and execute the SQL from `website/migrations/0001_initial_schema.sql` to initialize your tables:
   ```sql
   CREATE TABLE IF NOT EXISTS licenses (
     email TEXT PRIMARY KEY,
     license_key TEXT NOT NULL,
     customer_id TEXT,
     session_id TEXT,
     tier TEXT DEFAULT 'ProLifetime',
     created_at INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS devices (
     license_hash TEXT NOT NULL,
     machine_id TEXT NOT NULL,
     device_name TEXT DEFAULT 'Desktop Workstation',
     os TEXT DEFAULT 'Unknown OS',
     activated_at INTEGER NOT NULL,
     PRIMARY KEY (license_hash, machine_id)
   );

   CREATE INDEX IF NOT EXISTS idx_devices_license_hash ON devices (license_hash);
   CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON licenses (customer_id);
   ```

### Step 2: Bind D1 Database to Your Cloudflare Pages Project
1. In Cloudflare Dashboard &rarr; **Workers & Pages** &rarr; select your project.
2. Go to **Settings** &rarr; **Functions** &rarr; **D1 Database Bindings**.
3. Click **Add binding**:
   - Variable name: `wacpad binding` *(or `DB` — our gateway automatically supports both!)*
   - D1 database: `wacpad-db`

### Step 3: Configure Cloudflare Environment Variables & Secrets
Under **Settings** &rarr; **Variables and Secrets**, add the following:

> [!WARNING]
> **Security Notice**: Always click **Encrypt** when adding API keys so they are stored as encrypted **Secrets** in Cloudflare. **Never commit secrets to `wrangler.toml` or Git!**

| Name | Type | Value | Purpose |
| :--- | :--- | :--- | :--- |
| `STRIPE_SECRET_KEY` | **Secret** | `sk_live_...` (or `sk_test_...`) | Stripe payment processing |
| `STRIPE_WEBHOOK_SECRET` | **Secret** | `whsec_...` | Verifies `checkout.session.completed` events |
| `WACPAD_LICENSE_SECRET` | **Secret** | `wacpad-license-key-v1-secret` | Signs/verifies `WP1-` license keys |
| `ACTIVATION_TOKEN_PRIVATE_KEY` | **Secret** | `d2b426e25a5c69da785108714243fa911c42809034ee84e19f18e5eb5fac041d` | Signs offline `WPACT-` Ed25519 tokens |
| `RESEND_API_KEY` | **Secret** | `re_...` | Delivers license emails & lost key lookups |
| `EMAIL_FROM` | **Variable** | `WacPad Pro <licensing@wacpad.com>` *(or `WacPad Pro <onboarding@resend.dev>` for testing)* | Display from address |
| `NODE_ENV` | **Variable** | `production` | Strict production security enforcement |

### Step 4: Configure Stripe Webhook
In your [Stripe Dashboard](https://dashboard.stripe.com/webhooks):
1. Add an endpoint: `https://wacpad.com/api/webhook`
2. Select event: `checkout.session.completed`
3. Copy the **Signing secret** (`whsec_...`) and save it as `STRIPE_WEBHOOK_SECRET` in Cloudflare.

---

## 🔒 How Cryptographic Licensing Works End-to-End

1. **Customer Buys Pro ($14.99 Lifetime):**
   - Customer clicks **Buy Pro** on the website.
   - Redirected to Stripe Checkout (Apple Pay, Google Pay, or Card).
2. **Instant License Generation & Database Persistence:**
   - Stripe sends `checkout.session.completed` webhook to `https://wacpad.com/api/webhook`.
   - The webhook generates an HMAC-SHA256 signed `WP1-...` license key.
   - The customer mapping is saved into Cloudflare D1 (`licenses` table).
   - An email with the key and activation instructions is sent via Resend.
   - Stripe redirects customer to `/success.html?session_id={CHECKOUT_SESSION_ID}` where the key is displayed with 1-click clipboard copy.
3. **One-Click Activation & 3-Seat Hardware Limit:**
   - The user pastes their key into **WacPad Desktop** (`Settings` &rarr; `License Status`).
   - WacPad Desktop calls `POST /api/activate` with its unique hardware fingerprint.
   - Cloudflare D1 verifies the machine seat count ($< 3$), records the hardware ID in `devices`, and returns an offline Ed25519 `WPACT-...` activation token.
4. **iPad Unlocked Automatically:**
   - When the iPad connects to WacPad Desktop via Direct USB or Wi-Fi, the desktop server broadcasts `is_pro: true` in the initial handshake.
   - The iPad app immediately removes the top ad bar and unlocks the full canvas with no session limits!
