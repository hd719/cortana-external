#!/usr/bin/env bash
#
# Integration test for the Apple Health Bridge endpoints.
# Requires the external-service to be running locally.
#
# Usage:
#   APPLE_HEALTH_TOKEN=your-token ./scripts/test-health-bridge.sh
#
# Optional:
#   BASE_URL=http://localhost:3033 (default)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3033}"
TOKEN="${APPLE_HEALTH_TOKEN:-}"
PASS=0
FAIL=0

if [ -z "$TOKEN" ]; then
  echo "ERROR: APPLE_HEALTH_TOKEN is not set"
  echo "Usage: APPLE_HEALTH_TOKEN=your-token $0"
  exit 1
fi

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" -eq "$expected" ]; then
    green "PASS: $label (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    red "FAIL: $label — expected HTTP $expected, got HTTP $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Health Bridge Integration Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# 1. Health check (no auth required)
echo "--- GET /apple-health/health ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/apple-health/health")
assert_status "health check returns 200" 200 "$STATUS"

# 2. Test endpoint without auth
echo "--- POST /apple-health/test (no auth) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/apple-health/test" \
  -H "Content-Type: application/json" \
  -d '{"type":"health_test","deviceId":"test","deviceName":"test","sentAt":"2026-03-19T10:00:00.000Z","message":"hi"}')
assert_status "test without auth returns 401" 401 "$STATUS"

# 3. Test endpoint with valid auth
echo "--- POST /apple-health/test (with auth) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/apple-health/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"health_test","deviceId":"integration-test","deviceName":"Test Script","sentAt":"2026-03-19T10:00:00.000Z","message":"integration test"}')
assert_status "test with auth returns 200" 200 "$STATUS"

# 4. Sync endpoint with valid auth
echo "--- POST /apple-health/sync (with auth) ---"
SYNC_BODY='{"type":"health_sync","deviceId":"integration-test","deviceName":"Test Script","sentAt":"2026-03-19T12:00:00.000Z","range":{"start":"2026-03-18T00:00:00.000Z","end":"2026-03-19T00:00:00.000Z"},"metrics":{"steps":{"total":10000},"sleep":{"totalHours":8},"restingHeartRate":{"average":60},"workouts":[{"activityType":"running","start":"2026-03-18T07:00:00.000Z","end":"2026-03-18T07:30:00.000Z","durationMinutes":30}]},"appVersion":"1.0.0"}'
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/apple-health/sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$SYNC_BODY")
assert_status "sync with auth returns 200" 200 "$STATUS"

# 5. Sync endpoint without auth
echo "--- POST /apple-health/sync (no auth) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/apple-health/sync" \
  -H "Content-Type: application/json" \
  -d "$SYNC_BODY")
assert_status "sync without auth returns 401" 401 "$STATUS"

# 6. Test with invalid payload
echo "--- POST /apple-health/test (bad payload) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/apple-health/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"wrong"}')
assert_status "test with bad payload returns 400" 400 "$STATUS"

# 7. Health check after storing data
echo "--- GET /apple-health/health (after sync) ---"
BODY=$(curl -s "$BASE_URL/apple-health/health")
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/apple-health/health")
assert_status "health after sync returns 200" 200 "$STATUS"
if echo "$BODY" | grep -q '"healthy"'; then
  green "PASS: health status is healthy after sync"
  PASS=$((PASS + 1))
else
  red "FAIL: expected healthy status after sync"
  FAIL=$((FAIL + 1))
fi

# Summary
echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo ""
green "All integration tests passed!"
