#!/bin/bash
set -euo pipefail

# Ensure cargo and standard paths are in PATH
export PATH="$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

PASS=0
FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT=0
SERVER_PID=0

cleanup() {
  if [[ $SERVER_PID -gt 0 ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=0
  fi
}
trap cleanup EXIT

assert_status() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo -e "  ${GREEN}✓ PASS${NC}: $desc (HTTP $actual)"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ FAIL${NC}: $desc (expected $expected, got $actual)"
    ((FAIL++)) || true
  fi
}

assert_status_in() {
  local desc="$1" actual="$2"; shift 2
  local matched=0
  for exp in "$@"; do
    if [[ "$actual" == "$exp" ]]; then
      matched=1
      break
    fi
  done
  if [[ $matched -eq 1 ]]; then
    echo -e "  ${GREEN}✓ PASS${NC}: $desc (HTTP $actual)"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ FAIL${NC}: $desc (expected one of [$*], got $actual)"
    ((FAIL++)) || true
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi -- "$needle"; then
    echo -e "  ${GREEN}✓ PASS${NC}: $desc"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ FAIL${NC}: $desc (missing: '$needle')"
    ((FAIL++)) || true
  fi
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi -- "$needle"; then
    echo -e "  ${RED}✗ FAIL${NC}: $desc (found forbidden: '$needle')"
    ((FAIL++)) || true
  else
    echo -e "  ${GREEN}✓ PASS${NC}: $desc"
    ((PASS++)) || true
  fi
}

get_random_port() {
  node --input-type=module -e 'import net from "net"; const s = net.createServer(); s.listen(0, () => { console.log(s.address().port); s.close(); });'
}

start_server() {
  local env_mode="${1:-development}"
  PORT=$(get_random_port)
  echo -e "\n${BOLD}Starting WacPad server on port ${PORT} (NODE_ENV=${env_mode})...${NC}"

  NODE_ENV="$env_mode" PORT="$PORT" BASE_URL="http://127.0.0.1:${PORT}" node "$SCRIPT_DIR/server.js" > /dev/null 2>&1 &
  SERVER_PID=$!

  # Wait for server ready (poll with curl until 200)
  local retries=30
  local ready=0
  while [[ $retries -gt 0 ]]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -q "200"; then
      ready=1
      break
    fi
    sleep 0.1
    ((retries--)) || true
  done

  if [[ $ready -eq 1 ]]; then
    echo -e "  ${GREEN}✓ Server ready on http://127.0.0.1:${PORT}${NC}"
  else
    echo -e "  ${RED}✗ Failed to start server on port ${PORT}${NC}"
    exit 1
  fi
}

stop_server() {
  if [[ $SERVER_PID -gt 0 ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=0
  fi
}

echo -e "\n${BOLD}======================================================${NC}"
echo -e "${BOLD}  🚀 WacPad Automated Comprehensive E2E Test Suite     ${NC}"
echo -e "${BOLD}======================================================${NC}"

# 1. Runs npm test first (the 75-test unit suite)
echo -e "\n${BLUE}${BOLD}[PHASE 1] Running Node.js Test Suite (npm test)${NC}"
if (cd "$SCRIPT_DIR" && npm test); then
  echo -e "  ${GREEN}✓ PASS${NC}: Node.js unit & security test suite (75 tests)"
  ((PASS++)) || true
else
  echo -e "  ${RED}✗ FAIL${NC}: Node.js unit & security test suite failed"
  ((FAIL++)) || true
fi

# 2. Runs cargo test for Rust cross-platform verification
echo -e "\n${BLUE}${BOLD}[PHASE 2] Running Rust Cross-Platform Test Suite (cargo test)${NC}"
if (cd "$PROJECT_DIR" && cargo test); then
  echo -e "  ${GREEN}✓ PASS${NC}: Rust workspace test suite"
  ((PASS++)) || true
else
  echo -e "  ${RED}✗ FAIL${NC}: Rust workspace test suite failed"
  ((FAIL++)) || true
fi

# 3. Start local server in development mode
echo -e "\n${BLUE}${BOLD}[PHASE 3] Starting Server & Testing Endpoints (Development Mode)${NC}"
start_server "development"

# 4. Tests ALL endpoints with curl

# GET / -> expect 200, verify HTML contains 'WacPad'
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "GET / returns HTTP 200" "200" "$STATUS"
assert_contains "GET / response contains 'WacPad'" "$BODY" "WacPad"

# GET /cancel.html -> expect 200
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/cancel.html")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "GET /cancel.html returns HTTP 200" "200" "$STATUS"
assert_contains "GET /cancel.html contains 'Payment Was Not Completed'" "$BODY" "Payment Was Not Completed"
assert_contains "GET /cancel.html contains 'Try Again'" "$BODY" "Try Again"

# GET /lookup.html -> expect 200
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/lookup.html")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "GET /lookup.html returns HTTP 200" "200" "$STATUS"
assert_contains "GET /lookup.html contains 'Recover Your License Key'" "$BODY" "Recover Your License Key"

# GET /app-ads.txt -> expect 200, verify contains 'applovin'
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/app-ads.txt")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "GET /app-ads.txt returns HTTP 200" "200" "$STATUS"
assert_contains "GET /app-ads.txt contains 'applovin'" "$BODY" "applovin"

# POST /api/create-checkout-session -> expect 200, verify JSON has 'url' field
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.com"}' \
  "http://127.0.0.1:${PORT}/api/create-checkout-session")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "POST /api/create-checkout-session returns HTTP 200" "200" "$STATUS"
assert_contains "POST /api/create-checkout-session response has 'url' field" "$BODY" '"url"'

# Follow the mock redirect URL -> verify success.html loads (200)
REDIRECT_URL=$(node -e "const b = JSON.parse(process.argv[1]); console.log(b.url || '');" "$BODY")
if [[ -n "$REDIRECT_URL" ]]; then
  TEST_REDIRECT_URL=$(node -e 'try { const u = new URL(process.argv[1]); u.port = process.argv[2]; console.log(u.href); } catch { console.log(process.argv[1]); }' "$REDIRECT_URL" "$PORT")
  REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TEST_REDIRECT_URL")
  assert_status "Follow mock redirect URL loads success.html (HTTP 200)" "200" "$REDIRECT_STATUS"
else
  echo -e "  ${RED}✗ FAIL${NC}: Missing redirect URL from checkout session"
  ((FAIL++)) || true
fi

# GET /api/get-license?session_id=mock_test&mock=true&email=e2e@test.com -> expect 200, verify JSON has 'licenseKey' starting with 'WP1-'
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/api/get-license?session_id=mock_test&mock=true&email=e2e@test.com")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "GET /api/get-license returns HTTP 200" "200" "$STATUS"
assert_contains "GET /api/get-license has 'licenseKey' starting with 'WP1-'" "$BODY" '"licenseKey":"WP1-'

# Extract the license key and verify it with a Node.js one-liner
LICENSE_KEY=$(node -e "const b = JSON.parse(process.argv[1]); console.log(b.licenseKey || '');" "$BODY")
if [[ -n "$LICENSE_KEY" ]]; then
  VERIFY_OUT=$(cd "$SCRIPT_DIR" && node --input-type=module -e "import {verifyLicenseKey} from './lib/licensing.js'; const r = verifyLicenseKey('$LICENSE_KEY'); console.log(r.valid ? 'PASS' : 'FAIL: ' + r.error); process.exit(r.valid ? 0 : 1);")
  if [[ "$VERIFY_OUT" == "PASS" ]]; then
    echo -e "  ${GREEN}✓ PASS${NC}: Cryptographic verification of extracted license key: $LICENSE_KEY"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ FAIL${NC}: License verification failed: $VERIFY_OUT"
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ FAIL${NC}: Failed to extract license key from get-license response"
  ((FAIL++)) || true
fi

# POST /api/lookup-license with {"email":"e2e@test.com"} -> expect 200, verify response does NOT contain 'licenseKey' field
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.com"}' \
  "http://127.0.0.1:${PORT}/api/lookup-license")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "POST /api/lookup-license returns HTTP 200" "200" "$STATUS"
assert_not_contains "POST /api/lookup-license does NOT contain 'licenseKey' field (email-only delivery)" "$BODY" '"licenseKey"'
assert_contains "POST /api/lookup-license returns success status" "$BODY" '"success":true'

# POST /api/activate with license_key and machine_id in development -> expect 200, verify token
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"e2e-machine-id-1234\",\"os\":\"macOS\",\"device_name\":\"Test Mac\"}" \
  "http://127.0.0.1:${PORT}/api/activate")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "POST /api/activate returns HTTP 200 in development" "200" "$STATUS"
assert_contains "POST /api/activate returns WPACT- token" "$BODY" '"token":"WPACT-'
assert_contains "POST /api/activate returns seat count" "$BODY" '"seat":1'

# POST /api/devices with license_key in development -> expect 200, verify devices list
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\"}" \
  "http://127.0.0.1:${PORT}/api/devices")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "POST /api/devices returns HTTP 200 in development" "200" "$STATUS"
assert_contains "POST /api/devices returns devices array" "$BODY" '"devices"'

# POST /api/deactivate with license_key and machine_id -> expect 200, verify success
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"e2e-machine-id-1234\"}" \
  "http://127.0.0.1:${PORT}/api/deactivate")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
assert_status "POST /api/deactivate returns HTTP 200 in development" "200" "$STATUS"
assert_contains "POST /api/deactivate returns success" "$BODY" '"success":true'

# GET /../../../etc/passwd -> expect 403 or 404 (path traversal blocked)
RESPONSE=$(curl -s --path-as-is -w "\n%{http_code}" "http://127.0.0.1:${PORT}/../../../etc/passwd")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status_in "Path traversal: GET /../../../etc/passwd blocked" "$STATUS" "403" "404"

# GET /%2e%2e%2fserver.js -> expect 403 (encoded traversal blocked)
RESPONSE=$(curl -s --path-as-is -w "\n%{http_code}" "http://127.0.0.1:${PORT}/%2e%2e%2fserver.js")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status "Path traversal: GET /%2e%2e%2fserver.js returns HTTP 403" "403" "$STATUS"

# POST /api/webhook without stripe-signature in development (returns 200 or 400)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://127.0.0.1:${PORT}/api/webhook")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status_in "POST /api/webhook in development returns 200 or 400" "$STATUS" "200" "400"

# Security headers check: curl -I / -> verify X-Content-Type-Options, X-Frame-Options present
HEADERS=$(curl -s -I "http://127.0.0.1:${PORT}/")
assert_contains "Security header: X-Content-Type-Options is nosniff" "$HEADERS" "x-content-type-options: nosniff"
assert_contains "Security header: X-Frame-Options is DENY" "$HEADERS" "x-frame-options: DENY"

# 5. Production lockdown tests (restart server with NODE_ENV=production)
echo -e "\n${BLUE}${BOLD}[PHASE 4] Production Lockdown Tests (NODE_ENV=production)${NC}"
stop_server
start_server "production"

# POST /api/create-checkout-session -> expect 403
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}' \
  "http://127.0.0.1:${PORT}/api/create-checkout-session")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status "Production lockdown: POST /api/create-checkout-session returns HTTP 403" "403" "$STATUS"

# GET /api/get-license?session_id=mock_test&mock=true -> expect 403
RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${PORT}/api/get-license?session_id=mock_test&mock=true")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status "Production lockdown: GET /api/get-license mock mode returns HTTP 403" "403" "$STATUS"

# POST /api/lookup-license with {"email":"test@test.com"} -> expect 403
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}' \
  "http://127.0.0.1:${PORT}/api/lookup-license")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status "Production lockdown: POST /api/lookup-license unconfigured mock returns HTTP 403" "403" "$STATUS"

# POST /api/webhook without signature in production -> expect 400
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://127.0.0.1:${PORT}/api/webhook")
STATUS=$(echo "$RESPONSE" | tail -n1)
assert_status "Production lockdown: POST /api/webhook without signature returns HTTP 400" "400" "$STATUS"

# POST /api/activate in production without Redis -> expect 500
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"WP1-dummy\",\"machine_id\":\"prod-m1\"}" \
  "http://127.0.0.1:${PORT}/api/activate")
STATUS=$(echo "$RESPONSE" | tail -n1)
# Note: Since WP1-dummy is invalid key, it returns 400, or with valid key it returns 500
# Let's test with valid key if available, or assert 400/500
if [[ -n "${LICENSE_KEY:-}" ]]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"prod-m1\"}" \
    "http://127.0.0.1:${PORT}/api/activate")
  STATUS=$(echo "$RESPONSE" | tail -n1)
  assert_status "Production lockdown: POST /api/activate without Redis returns HTTP 500" "500" "$STATUS"
fi

# Stop server
stop_server

# 6. Print summary
echo -e "\n${BOLD}======================================================${NC}"
echo -e "${BOLD}               E2E TEST RUN SUMMARY                   ${NC}"
echo -e "${BOLD}======================================================${NC}"
echo -e "  ${GREEN}${BOLD}Passed:${NC} $PASS"
echo -e "  ${RED}${BOLD}Failed:${NC} $FAIL"

if [[ $FAIL -eq 0 ]]; then
  echo -e "\n${GREEN}${BOLD}✓ ALL E2E & VERIFICATION TESTS PASSED SUCCESSFULLY!${NC}\n"
  exit 0
else
  echo -e "\n${RED}${BOLD}✗ SOME TESTS FAILED! (Failures: $FAIL)${NC}\n"
  exit 1
fi
