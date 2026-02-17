#!/bin/bash
# Cortana Watchdog — runs every 15 min via launchd
# Pure shell, $0 cost, no AI involved

set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_TOKEN="$(cat /Users/hd/.openclaw/openclaw.json | jq -r '.channels.telegram.botToken')"
CHAT_ID="8171372724"
ALERTS=""
LOGS=""

log() {
  local severity="$1" msg="$2" meta="${3:-{}}"
  LOGS="${LOGS}\n[${severity}] ${msg}"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [${severity}] ${msg}"
  psql cortana -c "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('watchdog', 'watchdog.sh', '${severity}', '$(echo "$msg" | sed "s/'/''/g")', '$(echo "$meta" | sed "s/'/''/g")');" 2>/dev/null || true
}

alert() {
  local msg="$1"
  ALERTS="${ALERTS}• ${msg}\n"
  log "warning" "$msg"
}

# ── A) Cron Health ──
check_cron_health() {
  local cron_dir="/Users/hd/.openclaw/cron"
  if [[ -d "$cron_dir" ]]; then
    for state_file in "$cron_dir"/*.state.json; do
      [[ -f "$state_file" ]] || continue
      local name=$(basename "$state_file" .state.json)
      local consecutive_failures=$(jq -r '.consecutiveFailures // 0' "$state_file" 2>/dev/null || echo 0)
      if [[ "$consecutive_failures" -ge 3 ]]; then
        alert "Cron \`${name}\` has ${consecutive_failures} consecutive failures"
      fi
    done
  fi
  log "info" "Cron health check complete"
}

# ── B) Heartbeat Pileup ──
check_heartbeat_pileup() {
  local count=$(pgrep -f "openclaw.*heartbeat" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" -gt 1 ]]; then
    alert "Heartbeat pileup detected: ${count} processes running"
  fi
  log "info" "Heartbeat pileup check: ${count} processes"
}

# ── C) Tool Smoke Tests ──
check_tools() {
  # gog
  gog_exit=0
  timeout 5 gog --account hameldesai3@gmail.com gmail search 'newer_than:1d' --max 1 2>/dev/null || gog_exit=$?
  if [[ "$gog_exit" -eq 4 ]]; then
    alert "gog needs re-auth (exit code 4 = no auth)"
  elif [[ "$gog_exit" -eq 124 ]]; then
    alert "gog timed out (possible auth/network issue)"
  elif [[ "$gog_exit" -ne 0 ]]; then
    log "warning" "gog smoke test failed (exit $gog_exit)"
  else
    log "info" "gog: OK"
  fi

  # Tonal
  local tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/tonal/health 2>/dev/null || echo "000")
  if [[ "$tonal_code" != "200" ]]; then
    log "warning" "Tonal health check failed (HTTP ${tonal_code}), attempting self-heal"
    rm -f /Users/hd/Desktop/services/tonal_tokens.json
    sleep 5
    tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/tonal/health 2>/dev/null || echo "000")
    if [[ "$tonal_code" != "200" ]]; then
      alert "Tonal still down after self-heal (HTTP ${tonal_code})"
    else
      log "info" "Tonal self-healed successfully"
    fi
  else
    log "info" "Tonal: OK"
  fi

  # Whoop
  local whoop_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/whoop/data 2>/dev/null || echo "000")
  if [[ "$whoop_code" != "200" ]]; then
    log "warning" "Whoop health check failed (HTTP ${whoop_code})"
  else
    log "info" "Whoop: OK"
  fi

  # PostgreSQL
  if ! psql cortana -c "SELECT 1;" &>/dev/null; then
    alert "PostgreSQL is DOWN"
  else
    log "info" "PostgreSQL: OK"
  fi
}

# ── D) Budget Guard ──
check_budget() {
  local output
  output=$(node /Users/hd/clawd/skills/telegram-usage/handler.js 2>/dev/null) || { log "warning" "Budget check failed to run"; return; }
  
  local day_of_month=$(date +%d | sed 's/^0//')
  # Try to extract percentage from output
  local pct=$(echo "$output" | grep -oE '[0-9]+(\.[0-9]+)?%' | head -1 | tr -d '%')
  
  if [[ -n "$pct" && "$day_of_month" -lt 20 ]]; then
    local remaining=$(echo "$pct" | awk '{print 100 - $1}')
    local is_low=$(echo "$remaining" | awk '{print ($1 < 30) ? 1 : 0}')
    if [[ "$is_low" == "1" ]]; then
      alert "API budget low: ~${remaining}% remaining before day 20"
    else
      log "info" "Budget: ${remaining}% remaining"
    fi
  else
    log "info" "Budget check: day ${day_of_month}, output captured"
  fi
}

# ── Run all checks ──
echo "=== Watchdog run: $(date) ==="

check_cron_health
check_heartbeat_pileup
check_tools
check_budget

# ── Send alerts if any ──
if [[ -n "$ALERTS" ]]; then
  MSG="🐕 *Watchdog Alert*\n\n${ALERTS}\n_$(date '+%H:%M %b %d')_"
  "$SCRIPT_DIR/send_telegram.sh" "$BOT_TOKEN" "$CHAT_ID" "$(echo -e "$MSG")"
  log "info" "Alerts sent to Telegram"
fi

echo "=== Watchdog complete ==="
