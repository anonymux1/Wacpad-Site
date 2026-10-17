# Stage 5 Critical Code Audit Report

**Task ID**: WP-PAY-03 — Dual Gateway Hardening & Defense-in-Depth
**Auditor**: Claude Opus 4.6 (Thinking) — Independent Static Review
**Date**: 2026-10-16
**Scope**: AUDIT_PACKET Revision 4 evaluated against PROJECT_CONTEXT.md §1–§9

---

## 1. Instant-Rejection Rubric Evaluation

| # | Rule | Verdict | Reasoning |
|---|------|---------|-----------|
| 1 | **Scoped Hot-Path Allocation** | ✅ PASS | Zero changes to Tier 0 files (`protocol.rs`, `WacPadCanvasView.swift`, `win32.rs`, `macos.rs`). All modifications are confined to `website/` JavaScript — entirely outside touch/pointer call chains. |
| 2 | **WebSocket Backward Incompatibility** | ✅ PASS | `WsClientMessage` and `WsServerMessage` enums in `protocol.rs` are untouched. No protocol field additions. |
| 3 | **App Store Payment Neutrality** | ✅ PASS | Zero diff lines touch `ios/WacPad/`. No currency symbols (`$`, `€`, `₹`, `¥`), pricing strings, or external payment URLs introduced in iOS source. |
| 4 | **Coordinate Sign Corruption** | ✅ PASS | `MonitorInfo.left` / `.top` and all coordinate transformation code untouched. `display.rs` has zero diff. |
| 5 | **Private Key Leakage** | ✅ PASS | Ed25519 private signing key is never referenced outside `website/` serverless backend. No client or desktop binary references introduced. |
| 6 | **Unreviewed Entitlements / Export Flags** | ✅ PASS | `Info.plist` untouched. `ITSAppUsesNonExemptEncryption = false` preserved. |
| 7 | **Version String Desynchronization** | ✅ PASS | No version string modifications in this diff. Reported synchronized at `0.7.1` across `Cargo.toml`, `Info.plist`, `Package.swift`, and `package.json`. |

> **Instant-Rejection Gate: PASSED (0/7 violations)**

---

## 2. Tier Classification Verification

**Claimed**: Tier 1 (Security & Licensing) + Tier 2 (Store Compliance)

**Assessment**: **Correct**. All modified files fall within `website/api/`, `website/lib/`, and `website/public/` — squarely within the Tier 1 security & licensing boundary and Tier 2 public-facing compliance surface per §3. No Tier 0 hot-path files are touched.

---

## 3. Detailed Code Change Analysis

### A. CWE-598 Remediation — `verify-payment.js` → `main.js` → `success.js`

**Diff Evidence**:
```diff
- const redirectUrl = `...&license_key=${encodeURIComponent(licenseKey)}`;
+ const redirectUrl = `...&provider=razorpay`;
```

| Layer | Mechanism | Assessment |
|-------|-----------|------------|
| **Server** (`verify-payment.js`) | `license_key` fully removed from `redirectUrl`; only `session_id`, `email`, `provider` remain | ✅ Root cause eliminated |
| **Client handshake** (`main.js`) | `verifyData.licenseKey` captured from JSON response body → `sessionStorage.setItem('wacpad_pro_license', ...)` | ✅ Secure in-band transfer; `sessionStorage` is tab-scoped and cleared on close |
| **Success page** (`success.js`) | Reads `sessionStorage` first. If legacy `?license_key=` query param detected, immediately scrubs via `window.history.replaceState` before rendering | ✅ Backward-compatible defense-in-depth with immediate sanitization |
| **Cold reload fallback** (`get-license.js`) | New `getLicenseBySessionIdD1` / `getLicenseBySessionId` queries enable session-indexed retrieval without exposing secrets | ✅ Proper decoupling from Stripe-only path |

**Finding**: The `email` parameter remains in the redirect URL query string. While less sensitive than a license key, emails can leak via Referer headers. This is pre-existing behavior outside the current task scope and does not block approval, but is noted as a **future hardening candidate**.

### B. Webhook Idempotency & Key Immutability — `webhook-dodo.js`, `verify-payment.js`, `db.js`

**SQL Immutability Pattern** (`db.js`):
```diff
- license_key = excluded.license_key,
+ license_key = coalesce(licenses.license_key, excluded.license_key),
```

`COALESCE(licenses.license_key, excluded.license_key)` returns the **existing** key if non-NULL, falling through to the new value only if the column is NULL. This is the correct SQL idiom for "preserve first write, ignore subsequent overwrites." The same pattern is applied to `tier` and `created_at`, ensuring complete record immutability.

**Application-level guard** (both `webhook-dodo.js` and `verify-payment.js`):
```javascript
existing = d1 ? await getLicenseByEmailD1(d1, customerEmail)
               : await getLicenseByEmail(customerEmail);
if (existing && (existing.license_key || existing.licenseKey)) {
    licenseKey = existing.license_key || existing.licenseKey;
    // Skip email dispatch, return preserved key
}
```

✅ **Two-layer defense**: Application-level pre-check prevents unnecessary key generation entirely; SQL-level `COALESCE` serves as a safety net if the application check races against a concurrent worker isolate. This correctly addresses the cross-worker key-bricking scenario described in the behavioral delta.

### C. Enumeration Defense — `lookup-license.js`

**Critical Flow Analysis**:

1. `isMockMode` redefined as `!d1 && (!secretKey || ...)` — when D1 is available (modern deployment), mock mode is always `false`, so the old `403: "Payment service not configured"` branch is unreachable. ✅
2. New fallthrough after Stripe availability check returns the canonical privacy-preserving response:
   ```javascript
   return res.status(200).json({
     success: true,
     message: 'If a purchase exists for this email, your license key has been sent.',
   });
   ```
   This matches the specification in §6.G.3 exactly. ✅

**Assessment**: The enumeration oracle is fully closed. Both "email exists in D1 but not Stripe" and "email exists nowhere" now produce identical HTTP 200 responses.

### D. Environment Binding Harmonization — `devices.js`, `deactivate.js`, `create-order.js`, `create-dodo-checkout.js`

All four files consistently updated to `req.env?.VAR || process.env.VAR` pattern. The `deactivate.js` and `devices.js` diffs also extend the pattern to the full Redis URL/token fallback chain (`UPSTASH_KV_REST_API_URL`, `UPSTASH_REDIS_REST_URL`, `KV_REST_API_URL`). ✅ Consistent with §6.F adapter contract.

### E. `get-license.js` Stripe Lazy Import

```diff
- import Stripe from 'stripe';
+ const stripe = (await import('stripe')).default(secretKey);
```

The static `import Stripe from 'stripe'` at module top would crash in Cloudflare Workers environments where the `stripe` package isn't bundled. The dynamic import defers loading until actually needed (only when D1/Redis lookups both miss and a Stripe key is available). ✅ Correct ESM dynamic import pattern.

When Stripe key is absent, the response changes from `500` to `404`:
```diff
- return res.status(500).json({ error: 'Stripe secret key not configured on server' });
+ return res.status(404).json({ error: 'License record not found for this session ID' });
```
✅ Semantically correct — a missing Stripe key in a D1/Razorpay/Dodo deployment is not a server error; it means the record wasn't found in any available backend.

### F. New `db.js` Functions — `getLicenseBySessionIdD1`, `getLicenseBySessionId`

Both functions follow the established patterns of their sibling functions (`getLicenseByEmailD1`, `getLicenseByEmail`):
- NULL/empty guard → early return `null`
- Parameterized SQL bind (no string interpolation) → SQL injection safe
- Try/catch with `console.error` → graceful degradation
- `saveLicenseMapping` and `saveLicenseMappingD1` now index by `sessionId` key in both dev mock map and Redis

✅ Consistent, defensive, and correctly indexed.

### G. Email Branding & Success Page Neutrality

```diff
- View your Stripe Payment Receipt / Invoice
+ View your Payment Receipt / Invoice
```
```diff
- A confirmation email with your license key and Stripe receipt
+ A confirmation email with your license key and payment receipt
```

✅ Provider-neutral. Correct for a dual-gateway deployment serving Razorpay, Dodo, and legacy Stripe customers.

---

## 4. Context Drift Prevention (§9 Compliance)

The `PROJECT_CONTEXT.md` diff includes:

1. **Tier 1 file listing expanded**: Added `devices.js`, `lookup-license.js`, `get-license.js`, `create-order.js`, `verify-payment.js`, `create-dodo-checkout.js`, `webhook-dodo.js`, `geo.js` — all files that now contain security-critical licensing logic. ✅
2. **Seat limit corrected**: `max 2-seat device limits` → `max 3-seat device limits`, aligning with `MAX_SEATS = 3` specified in §1, §6.D, and §8. ✅ **This was actually a pre-existing documentation bug that this diff corrects.**
3. **Section 6.G added**: Documents CWE-598 defense, webhook idempotency, enumeration defense, and environment binding normalization — all four behavioral changes in this audit packet. ✅

**§9 Verdict**: COMPLIANT.

---

## 5. Test Evidence Assessment

| Category | Count | Notes |
|----------|-------|-------|
| Razorpay Integration | 7 | Includes redirectUrl sanitization and duplicate verify idempotency |
| Dodo + Geolocation | 8 | Includes duplicate webhook idempotency and `whsec_` decoding |
| Security Suites | 23 | Includes lookup enumeration defense |
| D1 SQL & Pages Gateway | 8 | Includes conflict resolution (`COALESCE` behavior) |
| Rust Core Licensing | 25 | Zero-change compatibility verification |
| **Total** | **175** | **0 failures** |

The test coverage directly maps to each acceptance criterion. The Razorpay and Dodo idempotency tests validate the key-bricking fix. The security suites validate enumeration defense. The D1 tests validate `COALESCE` conflict resolution. ✅ Adequate coverage.

---

## 6. Observations & Recommendations (Non-Blocking)

| # | Severity | Observation | Recommendation |
|---|----------|-------------|----------------|
| O-1 | **Low** | `email` parameter remains in redirect URL query string (`/success.html?...&email=...`). While far less sensitive than a license key, emails can leak via Referer headers to third-party assets on the success page. | Consider migrating `email` to `sessionStorage` transfer in a follow-up task, matching the `license_key` pattern. |
| O-2 | **Informational** | `webhook-dodo.js` retains the in-memory `processedPayments` Set alongside the new DB-level idempotency check. | The Set provides a fast-path dedup within a single isolate lifetime, which is harmless. The DB-level check handles the cross-isolate case. No action required — defense-in-depth. |
| O-3 | **Informational** | `success.js` uses `copyBtn.onclick = ...` (property assignment) instead of `addEventListener`. | This is intentional — prevents duplicate listener registration if `renderSuccess` is called multiple times. Correct pattern for this use case. |

---

## 7. Final Verdict

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   VERDICT:  ✅  APPROVED                                        │
│                                                                 │
│   Instant-Rejection Rubric:    0/7 violations                   │
│   Tier Classification:         Correct (Tier 1 + Tier 2)        │
│   Behavioral Deltas:           5/5 verified against spec        │
│   Acceptance Criteria:         7/7 met                          │
│   Context Drift (§9):         Compliant                         │
│   Test Evidence:               175 tests, 0 failures            │
│   Blocking Findings:           0                                │
│   Non-Blocking Observations:   3 (O-1 Low, O-2/O-3 Info)       │
│                                                                 │
│   This changeset correctly remediates CWE-598 information       │
│   disclosure, eliminates cross-worker webhook key-bricking via  │
│   SQL COALESCE immutability + application-level pre-checks,     │
│   closes an account enumeration oracle in lookup-license.js,    │
│   harmonizes Cloudflare req.env bindings across all endpoints,  │
│   and neutralizes provider-specific branding. All changes are   │
│   architecturally aligned with PROJECT_CONTEXT.md §4–§6,        │
│   and the context document itself is updated per §9.            │
│                                                                 │
│   Signed: Claude Opus 4.6 (Thinking) — Stage 5 Auditor         │
│   Date:   2026-10-16T16:09:51+05:30                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
