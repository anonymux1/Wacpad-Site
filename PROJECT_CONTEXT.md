# WacPad: Comprehensive Project Context & Auditor Technical Specification

> **Auditor Notice**: This document is the single, authoritative architectural reference manual for WacPad. External reviewer and auditor models (e.g., Claude Opus, GPT-4o) evaluating an `AUDIT_PACKET.md` must evaluate pull requests and git diffs **strictly against the specifications and invariants in this file without reading the underlying codebase or calling file-read tools**.

---

## 1. Executive Summary & System Identity

WacPad turns an iPad and Apple Pencil into a professional, low-latency Cintiq-class graphics digitizer tablet for Windows (and macOS). It provides:
* **Hardware-grade Latency**: Sub-millisecond direct USB latency (<0.5ms) via usbmuxd tunnel and high-performance Wi-Fi (<5ms) with seamless hot-standby failover.
* **Apple Pencil Fidelity**: Full 240Hz hardware touch sampling, 1024 pressure levels (10-bit), spherical tilt projection (azimuth + altitude -> rectangular tilt X/Y), and Apple Pencil Pro barrel roll rotation.
* **OS-Level Driverless Pointer Injection**: Emulates true Windows Pointer Device (`POINTER_TYPE_PEN`) via the Win32 Synthetic Pointer API and macOS Quartz `CGEvent` taps.
* **Dual-Tier Commercial Model**:
  * **Free Tier**: 30-minute drawing session limit with 5-second reconnect cooldown; 3 non-intrusive banner ad slots (Google AdMob & House Ads) in a 54pt top bar; 100% functional drawing engine.
  * **Pro Tier ($9.99 USD / ₹899 INR Lifetime)**: Permanent ad removal, full-screen edge-to-edge drawing canvas, unlimited session duration, multi-monitor display selection, and offline Ed25519 activation tokens for up to 3 devices (`MAX_SEATS = 3`). Dual-gateway checkout via Razorpay (India UPI/Cards) and Dodo Payments (International MoR).

---

## 2. The 5-Stage Worker / Auditor Operating Protocol

Engineering tasks follow a deterministic 5-stage pipeline separating execution from audit:

```
[Stage 1: Gemini Drafts Plan]
            │
            ▼
[Stage 2: Gemini Self-Review against 23-Point Checklist & Amends Plan]
            │
            ▼
[Stage 3: Opus Single-Pass Plan Review] ──(Zero Repo File Access; Plan + Context Only)
            │
            ▼ (Approved)
[Stage 4: Gemini Executes via Parallel Subagents, Runs Tests, & Conducts Self-Audit]
            │
            ▼
[Stage 5: Opus Single-Pass Code Audit] ──(Zero Repo File Access; AUDIT_PACKET + Context Only)
            │
            ▼
    [Final Sign-Off]
```

### Strict Auditor Operating Rules
1. **Zero Tool Calls & File Access**: The Auditor Model must **never** call `view_file`, `run_command`, `grep`, or directory listing tools. All evidence required for evaluation must be present within `PROJECT_CONTEXT.md` and the provided task artifact.
2. **Dual Rubric Enforcement**:
   * **Stage 3 (Plan Review)**: The auditor verifies architectural alignment, correct impact tiering, edge-case anticipation (negative coordinates, UIPI, AMDS failure), backward compatibility, and test verification strategies.
   * **Stage 5 (Code Audit)**: The auditor evaluates the git diff, test command logs, negative invariant citations, and behavioral deltas in `AUDIT_PACKET.md`.

### Worker (Gemini) Mandatory Self-Review Protocol
Before handing off to the Auditor, Gemini must verify:
* [ ] All modified files are assigned to their correct **Impact Tier** (0 to 3).
* [ ] No **Instant-Rejection Rubric** rule has been violated.
* [ ] Automated test suite (`cargo test --workspace` and/or `npm test`) executed cleanly with exit code `0`.
* [ ] The git diff is under 1,500 lines or logically chunked with a Before vs. After behavioral delta.

---

## 3. Repository Topology & 4-Tier File Classification

Every file in the repository belongs to an **Impact Tier** dictating review stringency:

| Tier | Category | Component Files | Strict Review Criteria |
| :--- | :--- | :--- | :--- |
| **Tier 0** | **Critical Hot Path** | `crates/wacpad-core/src/protocol.rs`<br/>`crates/wacpad-core/src/injector/win32.rs`<br/>`crates/wacpad-core/src/injector/macos.rs`<br/>`ios/WacPad/Sources/Views/WacPadCanvasView.swift`<br/>`ios/WacPad/Sources/Services/NetworkDiscoveryEngine.swift` (send loop) | **ZERO heap allocation** (`Vec::new`, `String::from`, `format!`), zero blocking locks, zero file I/O, coordinate clamping `[0.0, 1.0]`, NaN protection, 240Hz sub-millisecond dispatch. |
| **Tier 1** | **Security & Licensing** | `crates/wacpad-core/src/licensing.rs`<br/>`crates/wacpad-core/src/hardware.rs`<br/>`crates/wacpad-server/src/firewall.rs`<br/>`website/api/` (`activate.js`, `deactivate.js`, `devices.js`, `lookup-license.js`, `get-license.js`, `create-order.js`, `verify-payment.js`, `create-dodo-checkout.js`, `webhook-dodo.js`, `geo.js`, `webhook.js`)<br/>`website/lib/` (`licensing.js`, `db.js`) | Ed25519 cryptographic signatures, server-only private key isolation, irreversible SHA256 hardware fingerprints, constant-time verification, max 3-seat device limits. |
| **Tier 2** | **Store Compliance** | `ios/WacPad/Sources/Views/ContentView.swift`<br/>`ios/WacPad/Resources/Info.plist`<br/>`installer/wacpad_installer.iss`<br/>`crates/wacpad-cli/app.manifest`<br/>`website/public/` (`privacy.html`, `terms.html`, `app-ads.txt`) | Apple Guideline 3.1.3(b) neutrality (zero pricing/checkout links in iOS app), `ITSAppUsesNonExemptEncryption=false`, silent installer execution (`/VERYSILENT`), synced version strings. |
| **Tier 3** | **Host Plumbing & GUI** | `crates/wacpad-gui/` (`app.rs`, `tray.rs`, `curve_view.rs`, `autostart.rs`)<br/>`crates/wacpad-server/src/server.rs`<br/>`crates/wacpad-cli/src/main.rs`<br/>`crates/wacpad-cli/src/single_instance.rs` | Single instance mutex compliance, Axum routing, egui rendering, clean disconnect release, graceful shutdown. |

---

## 4. Protocol & Wire Specifications

### A. 24-Byte Compact Binary Pointer Packet
For direct USB and high-frequency binary WebSocket frames, WacPad uses a fixed 24-byte little-endian packed structure (`<BBHfffhhhH`):

```
Offset  Size  Type    Field        Description
0       1     u8      action       1=Down, 2=Move, 3=Up, 4=Hover, 5=Leave
1       1     u8      button       0=Left, 1=Middle, 2=Right
2       2     u16     flags        Bitwise flags (reserved)
4       4     f32     x            Normalized coordinate [0.0, 1.0]
8       4     f32     y            Normalized coordinate [0.0, 1.0]
12      4     f32     pressure     Normalized pressure [0.0, 1.0] (0.0 on Up/Hover/Leave)
16      2     i16     tilt_x       Degrees [-90, +90]
18      2     i16     tilt_y       Degrees [-90, +90]
20      2     i16     roll         Degrees [0, 360) (rem_euclid)
22      2     u16     reserved     Padding (must be 0)
Total: 24 bytes (zero heap allocation, stack-serializable via `[u8; 24]`)
```

### B. JSON WebSocket Protocol (`/ws`)
Used for control messages, latency telemetry, and fallback pointer events:

#### Client-to-Server (`WsClientMessage` - 7 Variants):
```jsonc
// 1. Client handshake metadata
{"type": "client_info", "info": {"device": "iPad12,1", "version": "0.7.0", "is_usb": true}}

// 2. High-precision latency ping
{"type": "ping", "time": 1727000000000, "client_perf": 120.0, "rtt": 1.2}

// 3. Display switching
{"type": "select_monitor", "id": 1}

// 4. Extended telemetry logging toggle
{"type": "set_extended_logging", "enabled": true}

// 5. Hotkeys (undo, redo, pan, brush, eraser, esc)
{"type": "hotkey", "key": "undo"}

// 6. JSON fallback pointer event
{"type": "pointer", "action": "move", "x": 0.523, "y": 0.412, "pressure": 0.85, "button": 0, "tiltX": 12.0, "tiltY": -5.0, "roll": 180.0}

// 7. Companion checkout trigger (DESKTOP/WEB CLIENTS ONLY - NEVER call from iOS)
{"type": "open_stripe_checkout"}
```
> [!WARNING]
> **Store Compliance Barrier**: `open_stripe_checkout` exists for desktop/browser companion flows. Calling or exposing this message in the iOS client will violate Apple Guideline 3.1.3(b) and lead to instant App Store rejection.

#### Server-to-Client (`WsServerMessage` - 5 Variants):
```jsonc
// 1. Connection initialisation & topology (6 fields)
{
  "type": "init",
  "monitors": [{"id": 0, "name": "Display 1", "left": 0, "top": 0, "width": 1920, "height": 1080, "is_primary": true}],
  "active_monitor": 0,
  "has_pt_pen": true,
  "server_wifi_ip": "192.168.1.100",  // Option<String>, serde(default, skip_serializing_if = "Option::is_none")
  "server_port": 8765,                 // Option<u16>, serde(default, skip_serializing_if = "Option::is_none")
  "is_pro": false                      // serde(default)
}

// 2. Session cap enforcement (Free Tier)
{"type": "session_cap", "reason": "Free tier 30-minute session cap reached", "limit_minutes": 30}

// 3. Session resumed after cooldown
{"type": "session_resumed"}

// 4. Monitor arrangement changed
{"type": "monitor_changed", "active_monitor": 1}

// 5. Ping-pong response with profiler metrics
{"type": "pong", "time": 1727000000000, "rtt_ms": 1.2, "jitter_ms": 0.15, "packet_rate_hz": 238.4, "inject_us": 42.0}
```

### C. Desktop Host HTTP REST Endpoints (10 Routes)
* `GET /` -> Embedded web client (`index.html`).
* `GET /api/discovery` -> Host discovery response (hostname, monitors, version, port).
* `GET /api/config` | `POST /api/config` -> Runtime settings (pressure curves, latency tracking).
* `POST /api/wake` -> Re-focuses host desktop and wakes display.
* `POST /api/shutdown` -> Graceful host process termination *(Loopback only: non-loopback IPs return `403 Forbidden`)*.
* `GET /api/license` -> Returns `{"is_pro": bool, "machine_id": "...", "status": "..."}`.
* `POST /api/license/activate` -> Activates key (`WP1-...`) or offline token (`WPACT-...`) *(Loopback only: `403 Forbidden`)*.
* `POST /api/license/deactivate` -> Clears local machine activation *(Loopback only: `403 Forbidden`)*.
* `GET /ws` -> WebSocket upgrade endpoint for pointer events and telemetry (includes CSWSH origin validation).
* `GET /{path}` -> Wildcard fallback serving embedded web client assets (`bundle.js`, CSS, SVGs).

### D. Website Serverless API Endpoints (Cloudflare Pages Functions / Node.js)
* `GET /api/geo` -> Cloudflare Edge geolocation detection returning country code and localized payment gateway preference.
* `POST /api/create-order` -> Generates canonical ₹899 Razorpay order ID with price parameter tampering defense (CWE-472).
* `POST /api/verify-payment` -> Verifies Razorpay HMAC-SHA256 signature, validates customer email, issues `WP1-...` Pro license, and persists to D1.
* `POST /api/create-dodo-checkout` -> Generates hosted Dodo Payments $9.99 USD MoR checkout session.
* `POST /api/webhook-dodo` -> Handles Dodo Standard Webhooks with HMAC verification (`whsec_` decoding); strictly fulfills `payment.succeeded`.
* `POST /api/activate` -> Machine hardware activation decoupling; validates exact license key in D1/Redis and mints offline `WPACT-...` Ed25519 token.
* `POST /api/deactivate` -> Machine deactivation endpoint releasing hardware seats.
* `GET /api/devices` -> Returns currently activated device seats for a license key.
* `POST /api/lookup-license` -> Self-service license key recovery via email.
* `POST /api/create-checkout-session` -> Legacy Stripe checkout session creation.
* `POST /api/webhook` -> Legacy Stripe webhook handler.
* `GET /api/get-license` -> Legacy post-checkout session verification.

---

## 5. Subsystems Deep-Dive

### A. Win32 Synthetic Pointer Injection (`crates/wacpad-core/src/injector/win32.rs`)
* **API**: `InjectSyntheticPointerInput(HANDLE, *const POINTER_PEN_INFO, count)` loaded dynamically from `user32.dll`. Falls back to `SendInput` mouse/keyboard emulation if synthetic pointer is unavailable.
* **Process Environment**:
  - `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` set at process launch.
  - `SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS)` ensures priority over background tasks.
  - High-resolution timing: `timeBeginPeriod(1)` called at initialization, `timeEndPeriod(1)` on drop.
* **Base Flags**:
  All active frames inherit the baseline bitmask:
  ```rust
  let flags = POINTER_FLAG_INRANGE | POINTER_FLAG_PRIMARY | POINTER_FLAG_CONFIDENCE;
  ```
* **Flags State Machine & Atomic Multi-Frame Sequences**:
  - **Down (2-Frame Atomic Sequence)**:
    - *Frame 1 (Pre-positioning at pressure 0)*: `flags | POINTER_FLAG_UPDATE`
    - *Frame 2 (Actual contact)*: `flags | POINTER_FLAG_DOWN | POINTER_FLAG_INCONTACT | POINTER_FLAG_FIRSTBUTTON`
  - **Move**: `flags | POINTER_FLAG_UPDATE`. Contact bits (`POINTER_FLAG_INCONTACT | POINTER_FLAG_FIRSTBUTTON`) are **conditionally added only when** `calibrated_p > 0.0 && action != 4 (Hover)`. If pressure is 0.0, Move injects as a hovering in-range update.
  - **Up**: `flags | POINTER_FLAG_UP` (pressure forced to 0.0; `pi.pressure = 0`).
  - **Hover**: `flags | POINTER_FLAG_UPDATE`.
    *Note: Pressure zeroing for Hover occurs at the server protocol dispatch level (`server.rs:595`), while `win32.rs` injects calibrated pressure as passed.*
  - **Leave**: `POINTER_FLAG_UPDATE | POINTER_FLAG_PRIMARY`.
    *Important: The `POINTER_FLAG_INRANGE` bit is intentionally omitted/cleared (it is **NOT** `POINTER_FLAG_NONE`). If the pen was in contact prior to Leave, `win32.rs` first dispatches an immediate synthetic `Up` frame before dispatching the Leave frame (`win32.rs:337–353`).*
* **Pen Mask**: `PEN_MASK_PRESSURE | PEN_MASK_TILT_X | PEN_MASK_TILT_Y | PEN_MASK_ROTATION`.
* **Pressure Scaling**: Strictly scaled to `0..1024` (10-bit integer resolution) via `(calibrated_p * 1024.0).clamp(...) as u32`.
* **UIPI Elevation Boundary**:
  - Declared in `crates/wacpad-cli/app.manifest` as `asInvoker`.
  - Windows UIPI prevents non-elevated processes from injecting input into applications running "As Administrator". If Photoshop or Krita is run as Admin, WacPad must be launched with matching administrator privileges.
* **Disconnect Failsafe**:
  - If a connection drops while the pen is in contact, the server watchdog or disconnect handler immediately dispatches a synthetic `Up` event (pressure 0.0), followed by `Leave`, preventing physical cursor drag-lock.

### B. macOS Quartz Event Tap Injection (`crates/wacpad-core/src/injector/macos.rs`)
* **API**: `CGEventCreateMouseEvent`, `CGEventPost(kCGHIDEventTap, event)`, `CGEventSetDoubleValueField`.
* **Field Identifiers**:
  - Pressure: `kCGMouseEventPressure = 87` (0.0 to 1.0 double).
  - Tablet Subtype: `kCGEventMouseSubtype = 110` (subtype 1 for tablet pointer events).
* **Permissions**: Requires macOS Accessibility permissions (`AXIsProcessTrustedWithOptions`).

### C. Multi-Monitor Coordinate Topology & Negative Coordinate Arithmetic
* **Virtual Desktop Union**: `VirtualDesktop::compute_from_monitors(&monitors)` computes the minimum and maximum bounding coordinates across all screens.
* **Negative Coordinate Invariant**:
  - Displays placed to the left of or above the primary monitor have **negative offsets** (`m.left < 0`, `m.top < 0`).
  - `MonitorInfo.left` and `MonitorInfo.top` **MUST remain signed 32-bit integers (`i32`)**. Converting them to unsigned types breaks desktop layouts.
* **Mapping Formula**:
  $$\text{pixel\_x} = m.\text{left} + \text{round}(\text{safe\_nx} \times (m.\text{width} - 1))$$
  $$\text{pixel\_y} = m.\text{top} + \text{round}(\text{safe\_ny} \times (m.\text{height} - 1))$$
  Where `safe_nx = if nx.is_nan() { 0.0 } else { nx.clamp(0.0, 1.0) }`.

### D. Session Cap Subsystem (`crates/wacpad-server/src/server.rs` & `wacpad-gui/src/app.rs`)
* **Duration**: 30 minutes in Free Tier (or 30 seconds if `--debug-session-timer` is active). Unlimited in Pro Tier.
* **Enforcement Pipeline**:
  - Server maintains `session_capped: Arc<AtomicBool>` and `session_cap_tx: broadcast::Sender<bool>`.
  - When capped, server transmits `WsServerMessage::SessionCap` and blocks incoming pointer injection (except `action=3` Up and `action=5` Leave to avoid stuck strokes).
  - GUI triggers a modal overlay with a 5-second countdown timer before the "Reconnect" button enables.
  - Clicking "Reconnect" clears `session_capped` to `false`, broadcasts `SessionResumed`, and restarts the session timer.

### E. Pressure Curve Subsystem (`crates/wacpad-core/src/pressure.rs`)
* **Presets**: `Linear`, `Soft` (concave upward), `Firm` (convex downward), `SCurve` (sigmoid), and `Custom`.
* **Structure**: `PressureCurve { preset: PressurePreset, p1: (f32, f32), p2: (f32, f32) }` representing a cubic Bézier mapping $(0,0) \to p_1 \to p_2 \to (1,1)$.
* **Evaluation**: `curve.apply(p: f32) -> f32` calculates Bézier root $t$ for input pressure $x$ and returns interpolated $y$, clamped strictly to `[0.0, 1.0]`.

### F. iOS Client Architecture & Ad Slot Layout (`ios/WacPad/Sources/`)
* **Touch Pipeline (`WacPadCanvasView.swift`)**:
  - Subclasses `UIView` with `coalescedTouches(for: pencilTouch)` to process all 240Hz hardware samples between frame renders.
  - Hardware Palm Rejection: Touches where `touch.type != .pencil` are strictly ignored.
  - Barrel Roll: Apple Pencil Pro roll angle extracted via `touch.value(forKey: "rollAngle")` in degrees `[0, 360)`.
* **Ad Slot Geometry (`ContentView.swift`)**:
  - In Free Tier (`!networkEngine.isPro`), a 54pt top bar displays up to 3 `BannerSlotContainer` instances (320x50 fixed):
    - Slot 1: Google AdMob Banner #1.
    - Slot 2: Alternates every 30s between House Ad and AdMob Banner #2.
    - Slot 3 (Landscape only): Google AdMob Banner #3.
  - Canvas Deadzone: `WacPadCanvasView` discards pencil touches where `loc.y < 54.0` in Free Tier to prevent accidental drawing over banner ads.
  - In Pro Tier: Banner bar is completely unmounted, unlocking 100% full-screen edge-to-edge drawing.

### G. Transport Mechanics & Hot-Standby Failover
* **Direct USB usbmuxd Loopback**:
  - iPad creates an `NWListener` on `127.0.0.1:8766`.
  - Windows host connects to Apple Mobile Device Service (AMDS) on `127.0.0.1:27015` and opens a usbmuxd tunnel to port 8766.
  - Fallback: If AMDS is not installed or service is stopped, USB connection fails immediately and gracefully falls back to Wi-Fi mDNS without crashing.
* **Wi-Fi Hot-Standby**:
  - When USB is active, the iPad maintains a background Wi-Fi standby WebSocket task.
  - If the USB cable is detached mid-drawing, `handleIncomingUSBConnection` detects cancellation and seamlessly promotes the Wi-Fi standby connection with zero stroke interruption.

### H. WebSocket Keepalive & Profiler Loop (`crates/wacpad-core/src/profiler.rs`)
* Client transmits periodic `ping` packets with high-precision timestamp.
* Server computes round-trip time (RTT), jitter, and packet frequency, returning `pong`.
* `LatencyProfiler` stores rolling statistics and captures `AnomalyIncident` records when RTT exceeds 50ms or packet gaps exceed thresholds.

### I. mDNS Discovery Registration (`crates/wacpad-core/src/mdns.rs`)
* Registers service `_wacpad._tcp.local.` on port 8765.
* Sanitizes hostnames to RFC-compliant alphanumeric characters and hyphens.
* On macOS, spawns `/usr/bin/dns-sd -R <name> _wacpad._tcp local <port>`, falling back to `mdns-sd`.
* On iOS, `NWBrowser` searches for descriptor `_wacpad._tcp`.

### J. ServerEvent Enum (`crates/wacpad-server/src/server.rs`)
The host server communicates with the desktop GUI via an unbounded `tokio::sync::mpsc::UnboundedSender<ServerEvent>` channel using 11 typed events:
1. `ClientConnected { device: String, ip: String, is_usb: bool }`
2. `ClientDisconnected`
3. `PointerEvent { action: String, pressure: f32, tilt_x: i16, tilt_y: i16 }`
4. `LatencyUpdate(LatencyStats)`
5. `MonitorChanged(i32)`
6. `WakeRequested`
7. `ShutdownRequested`
8. `UsbDeviceAttached(u32)`
9. `UsbDeviceDetached(u32)`
10. `SessionCapped`
11. `SessionResumed`

---

## 6. Cryptographic Licensing & Hardware Fingerprinting

### A. Ed25519 Offline Activation Tokens (`crates/wacpad-core/src/licensing.rs`)
* **Token Format**: `WPACT-<base64(payload_json + 64_byte_ed25519_signature)>`
* **Public Key**: Hardcoded 32-byte constant `ACTIVATION_PUBLIC_KEY: [u8; 32]` in `wacpad-core`.
* **Payload Structure (Untyped JSON `serde_json::Value`)**:
  ```json
  {
    "license_hash": "sha256_hex_of_wp1_key",
    "machine_id": "64_char_hex_hardware_fingerprint",
    "seat": 1,
    "max_seats": 2,
    "email": "user@example.com",
    "activated_at": 1727000000
  }
  ```
* **Security Invariant**: The Ed25519 private signing key exists **strictly on the serverless website backend** (`ACTIVATION_TOKEN_PRIVATE_KEY` env var) and must **never** be present in client or desktop binaries.

### B. HMAC-SHA256 Online License Keys
* **Key Format**: `WP1-<base64(payload_json + 32_byte_hmac_sha256_signature)>`
* **Secret**: `const LICENSE_SECRET: &[u8] = b"wacpad-license-key-v1-secret"`
* **Payload Structure (`LicensePayload` Typed Rust Struct)**:
  ```rust
  pub struct LicensePayload {
      pub email: String,
      pub tier: LicenseTier,     // Free, ProLifetime, ProAnnual
      pub issued_at: u64,
      pub expires_at: Option<u64>,
  }
  ```

### C. Salted Hardware Fingerprint (`crates/wacpad-core/src/hardware.rs`)
* Generates a deterministic, irreversible SHA-256 hash using salt `pub const HW_SALT: &[u8] = b"wacpad-hw-fingerprint-salt-v1"`.
* **Composite Format**: `{MachineGuid}:{hardware_id}`
  - `MachineGuid` is **always queried** from `HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid`.
  - The fallback chain applies **strictly to the `hardware_id` component**:
    1. Primary: `reg query HKLM\HARDWARE\DESCRIPTION\System\BIOS /v BaseBoardProduct`
    2. Fallback 1: PowerShell `(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID`
    3. Fallback 2: Legacy `wmic csproduct get UUID`
  - **Ultimate Fallback**: If the composite string is $\le 5$ characters (both queries failed), returns `{hostname}:{user}` via `get_fallback_id()`.
* **Drift Protection**: Fingerprint binds to motherboard and OS installation; peripheral USB swaps do not invalidate the machine seat.

### D. Cloudflare D1 SQL & Database Seat Tracking
* **Primary (Cloudflare Native)**: Cloudflare D1 serverless SQLite (`website/migrations/0001_initial_schema.sql`):
  - `licenses` table: `(email PRIMARY KEY, license_key, customer_id, session_id, tier, created_at)`
  - `devices` table: `(license_hash, machine_id, device_name, os, activated_at, PRIMARY KEY (license_hash, machine_id))`
  - ACID seat enforcement: `SELECT COUNT(*) FROM devices WHERE license_hash = ?` strictly enforced at max 3 seats (`MAX_SEATS = 3`).
* **Fallback / Alternate**: Upstash Redis (`license:{hash}:machines` hash) with atomic Lua script.
* **Enforcement**: Activating beyond `MAX_SEATS` unique machines returns an HTTP 403 error unless an existing machine is deactivated at `https://wacpad.com/lookup.html`.

### E. Dual-Gateway Commercial Architecture (Razorpay + Dodo Payments)
WacPad employs an edge-routed dual payment gateway architecture to ensure optimal regional conversion, low fees, and complete global tax compliance:
1. **Domestic India Routing (Razorpay)**:
   - **Trigger**: Cloudflare Edge inspects `cf-ipcountry == 'IN'`.
   - **Pricing**: Fixed domestic pricing at ₹899 INR (one-time lifetime).
   - **Endpoints**:
     - `POST /api/create-order`: Generates a genuine Razorpay Order ID via Basic Auth against `api.razorpay.com/v1/orders`.
     - `POST /api/verify-payment`: Validates the payment signature using constant-time HMAC-SHA256(`order_id + "|" + payment_id`, `RAZORPAY_KEY_SECRET`), mints a deterministic `WP1-...` Pro lifetime key, writes to Cloudflare D1, and dispatches the fulfillment email.
   - **Supported Rails**: Instant UPI QR (GPay, PhonePe, Paytm, BHIM), RuPay/Visa/Mastercard domestic cards, and Netbanking.
2. **International Global Routing (Dodo Payments)**:
   - **Trigger**: Non-India visitors (`cf-ipcountry != 'IN'`).
   - **Pricing**: $9.99 USD (one-time lifetime).
   - **Role**: Dodo Payments acts as the Merchant of Record (MoR), collecting and remitting global sales tax/VAT across 100+ countries with zero foreign tax nexus liability.
   - **Endpoints**:
     - `POST /api/create-dodo-checkout`: Creates a hosted checkout session (`cks_...`) for product `pdt_0NpqdjR6faKYqLtCgr6Ma`.
     - `POST /api/webhook-dodo`: Handles `payment.succeeded` events with Standard Webhooks signature verification (`webhook-signature`, `webhook-id`, `webhook-timestamp`), issues the `WP1-...` license, and persists to D1.
   - **Supported Rails**: International Credit/Debit cards, Apple Pay, Google Pay.

### F. Cloudflare Pages Functions Adapter (`functions/_adapter.js`)
* Bridges Cloudflare Pages Web Standard `Request` / `Response` / `EventContext` to existing Node.js `(req, res)` handlers.
* Preserves 100% backwards compatibility with local Node test runners and tests without changing core business logic.
* Automatically polyfills `process.env` from Cloudflare Worker secrets (`req.env`) and injects the native Cloudflare D1 SQL database binding (`env.DB`).
* Configures permissive CORS preflight and methods for webhook signature verification.

### G. Defense-in-Depth & Payment Hardening (CWE-598, Webhook Idempotency, and Lookup Privacy)
1. **URL Query String Sanitization (CWE-598 Defense)**:
   - `POST /api/verify-payment`: Redirect URL strictly excludes `license_key` query parameters, navigating to `/success.html?session_id={paymentId}&email={customerEmail}&provider=razorpay`.
   - Client Handshake: `public/js/main.js` receives `licenseKey` in the secure JSON response body and stages it in browser `sessionStorage`.
   - Immediate History Scrubbing: `public/js/success.js` immediately scrubs any legacy `?license_key=` query parameter from the browser URL bar and history via `window.history.replaceState` before rendering to prevent Referer header leakage, shoulder surfing, and log harvesting.
   - Universal Database Session Lookup: `GET /api/get-license?session_id=...` queries Cloudflare D1 SQL via `getLicenseBySessionIdD1` and Redis via `getLicenseBySessionId` across all gateways (Razorpay, Dodo, and Stripe) on cold page reloads.
2. **Cross-Worker Webhook Idempotency & License Key Immutability**:
   - `saveLicenseMappingD1` enforces SQL immutability on conflict:
     `license_key = coalesce(licenses.license_key, excluded.license_key)`.
   - `api/webhook-dodo.js` & `api/verify-payment.js`: Both handlers query D1/Redis prior to generating a new key. If an active key exists for the customer, the key is preserved and duplicate deliveries return `200 { duplicate: true }`, preventing key-bricking across multi-region serverless worker isolates.
3. **Lookup Privacy & Account Enumeration Defense**:
   - `POST /api/lookup-license`: Returns identical HTTP 200 message `{"success": true, "message": "If a purchase exists for this email, your license key has been sent."}` regardless of whether an email exists in D1 or Stripe, preventing email harvesting and configuration status leaks.
4. **Environment Binding Normalization**:
   - All serverless endpoints (`devices.js`, `deactivate.js`, `create-order.js`, `create-dodo-checkout.js`) uniformly inspect `req.env?.VAR || process.env.VAR` ensuring flawless execution across Cloudflare Pages Functions edge runtimes.

---

## 7. Store Compliance & Packaging Prerequisites

### A. Microsoft Store (Unpackaged Win32)
* Built via Inno Setup 6.7.3 into `dist/WacPad_Setup_v0.7.exe`.
* **Silent Ingestion Mandate**: Microsoft Partner Center automated certification executes the installer in a headless sandbox via `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`.
* **AppMutex**: Must match `Local\WacPad_SingleInstance_Mutex_v2,Global\WacPad_SingleInstance_Mutex_v2` to prevent file-locking collisions during updates.

### B. Apple App Store Guidelines
* **Guideline 2.1 (App Completeness)**: The discovery screen includes a complete 4-step setup guide and direct links to documentation so reviewers on isolated networks do not face a dead screen.
* **Guideline 3.1.3(b) (Multiplatform Companion Neutrality)**:
  - ZERO external purchase links.
  - ZERO pricing text (no mentions of "$9.99", "Lifetime", or currency symbols).
* **Export Compliance**: `ITSAppUsesNonExemptEncryption = false` declared in `Info.plist` (uses standard exempt authentication cryptography).
* **Icon Specifications**: Exact 1024×1024 PNG in **RGB mode without alpha channel** in `Assets.xcassets/AppIcon.appiconset`.

---

## 8. The Auditor's Instant-Rejection Rubric

The Auditor Model must immediately **REJECT** any incoming pull request or git diff that commits any of the following 7 anti-patterns:

1. **Scoped Hot-Path Allocation**: Introducing heap allocation (`Vec::new()`, `String::from()`, `format!()`, `Box::new()`, `new Array()`) within call chains reachable from `touchesBegan/Moved/Ended`, `handlePencilTouches`, `readNextUSBFrame`, or `process_pointer_packet`.
2. **WebSocket Backward Incompatibility**: Adding any new field to `WsClientMessage` or `WsServerMessage` without `#[serde(default)]` or `#[serde(skip_serializing_if = "Option::is_none")]`.
3. **App Store Payment Non-Neutrality**: Adding any currency symbol (`$`, `€`, `¥`), price string, or payment gateway URL (Stripe, Razorpay, Dodo Payments) anywhere inside `ios/WacPad`.
4. **Coordinate Sign Corruption**: Modifying `MonitorInfo.left` or `MonitorInfo.top` from signed `i32` to unsigned `u32`, or dropping sign handling in coordinate transformation.
5. **Private Key Leakage**: Referencing or importing the Ed25519 private signing key anywhere outside `website/` or `wacpad-site/`.
6. **Unreviewed Entitlements / Export Flags**: Adding new iOS capabilities/entitlements or altering `ITSAppUsesNonExemptEncryption` in `Info.plist`.
7. **Version String Desynchronization**: Changing version numbers without updating all synchronization targets: `Cargo.toml` (0.7.1), `Info.plist` (0.7.1), `wacpad_installer.iss` (0.7.1), and `app.manifest` (0.7.1.0).

---

## 9. Context Drift Prevention & Maintenance Rule

`PROJECT_CONTEXT.md` is a living contract. **Any code change that adds an HTTP endpoint, modifies protocol messages, alters licensing logic, or updates hardware invariants must include a corresponding diff to `PROJECT_CONTEXT.md` in its acceptance packet.** An audit packet lacking documentation updates for architectural changes must be rejected.
