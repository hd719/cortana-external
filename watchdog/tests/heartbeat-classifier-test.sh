#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/heartbeat_classifier.sh"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

assert_case() {
  local name="$1"
  local expected="$2"
  local got="$3"
  if [[ "$got" == "$expected" ]]; then
    pass "$name"
  else
    fail "$name (expected '$expected', got '$got')"
  fi
}

assert_case "normal/healthy" "ok|heartbeat stable" "$(classify_heartbeat_health 1 1200 0 45)"
assert_case "warning/high age" "warning|heartbeat process age high (2500s)" "$(classify_heartbeat_health 1 2500 0 45)"
assert_case "warning/variance" "warning|heartbeat timing variance elevated (420s drift)" "$(classify_heartbeat_health 1 1200 0 420)"
assert_case "critical/no process" "critical|no heartbeat process running" "$(classify_heartbeat_health 0 0 0 0)"
assert_case "critical/pileup" "critical|heartbeat pileup (3 processes)" "$(classify_heartbeat_health 3 0 0 0)"
assert_case "critical/restarts" "critical|heartbeat restarted 5x in 6h" "$(classify_heartbeat_health 1 800 5 20)"
assert_case "recovered/ok" "ok|heartbeat stable" "$(classify_heartbeat_health 1 900 1 40)"

echo "All heartbeat classifier tests passed."
