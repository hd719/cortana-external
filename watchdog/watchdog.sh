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
STATE_FILE="$SCRIPT_DIR/watchdog-state.json"
FITNESS_BASE_URL="${FITNESS_BASE_URL:-http://localhost:3033}"

# ── State Management ──
load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE" 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}

save_state() {
  local state="$1"
  echo "$state" > "$STATE_FILE" 2>/dev/null || true
}

get_current_timestamp() {
  date +%s
}

# Get the last alert time for a specific check
get_last_alert_time() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".last_alert // 0" 2>/dev/null || echo "0"
}

# Get the first failure time for a specific check
get_first_failure_time() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".first_failure // 0" 2>/dev/null || echo "0"
}

# Update state for a check
update_check_state() {
  local check_name="$1"
  local status="$2"  # "failing" or "recovered"
  local current_time=$(get_current_timestamp)
  local state=$(load_state)
  
  if [[ "$status" == "failing" ]]; then
    local first_failure=$(get_first_failure_time "$check_name")
    if [[ "$first_failure" == "0" ]]; then
      first_failure="$current_time"
    fi
    state=$(echo "$state" | jq --arg check "$check_name" --argjson time "$current_time" --argjson first "$first_failure" \
      '.[$check] = {last_alert: $time, first_failure: $first, status: "failing"}')
  else
    # Clear failure state on recovery
    state=$(echo "$state" | jq --arg check "$check_name" --argjson time "$current_time" \
      '.[$check] = {last_alert: 0, first_failure: 0, status: "recovered", last_recovery: $time}')
  fi
  
  save_state "$state"
}

# Check if we should suppress this alert
should_suppress_alert() {
  local check_name="$1"
  local current_time=$(get_current_timestamp)
  local last_alert=$(get_last_alert_time "$check_name")
  local first_failure=$(get_first_failure_time "$check_name")
  
  # First occurrence - never suppress
  if [[ "$last_alert" == "0" ]]; then
    return 1  # Don't suppress
  fi
  
  # Special case for Tonal: if failing >1 hour, only alert every 6 hours
  if [[ "$check_name" == *"Tonal"* ]]; then
    local failure_duration=$((current_time - first_failure))
    if [[ "$failure_duration" -gt 3600 ]]; then  # >1 hour
      local time_since_last=$((current_time - last_alert))
      if [[ "$time_since_last" -lt 21600 ]]; then  # <6 hours
        return 0  # Suppress
      fi
    fi
  fi
  
  # General suppression: don't repeat identical alerts within 6 hours
  local time_since_last=$((current_time - last_alert))
  if [[ "$time_since_last" -lt 21600 ]]; then  # <6 hours
    return 0  # Suppress
  fi
  
  return 1  # Don't suppress
}

log() {
  local severity="$1" msg="$2" meta="${3:-{}}"
  LOGS="${LOGS}\n[${severity}] ${msg}"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [${severity}] ${msg}"
  psql cortana -c "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('watchdog', 'watchdog.sh', '${severity}', '$(echo "$msg" | sed "s/'/''/g")', '$(echo "$meta" | sed "s/'/''/g")');" 2>/dev/null || true
}

alert() {
  local msg="$1"
  local check_name="${2:-$msg}"  # Use msg as check_name if not provided
  
  if should_suppress_alert "$check_name"; then
    log "info" "Suppressed repeated alert: $msg"
    return
  fi
  
  ALERTS="${ALERTS}• ${msg}\n"
  log "warning" "$msg"
  update_check_state "$check_name" "failing"
}

# Send recovery alert for a previously failing check
recovery_alert() {
  local check_name="$1"
  local msg="$2"
  local state=$(load_state)
  local check_status=$(echo "$state" | jq -r ".\"$check_name\".status // \"unknown\"" 2>/dev/null || echo "unknown")
  
  # Only send recovery alert if the check was previously failing
  if [[ "$check_status" == "failing" ]]; then
    ALERTS="${ALERTS}✅ ${msg}\n"
    log "info" "Recovery: $msg"
    update_check_state "$check_name" "recovered"
  fi
}

# ── A) Cron Health ──
check_cron_quarantine() {
  local qdir="${HOME}/.openclaw/cron/quarantine"
  if [[ ! -d "$qdir" ]]; then
    log "info" "Cron quarantine check: none"
    return
  fi

  local found=0
  for qf in "$qdir"/*.quarantined; do
    [[ -f "$qf" ]] || continue
    found=1
    local name
    name=$(basename "$qf" .quarantined)
    local reason
    reason=$(tail -n 1 "$qf" 2>/dev/null || echo "unknown")
    alert "Cron \`${name}\` is quarantined (${reason})" "cron_quarantine_${name}"
  done

  if [[ "$found" -eq 0 ]]; then
    log "info" "Cron quarantine check: none"
  fi
}

check_cron_health() {
  local cron_dir="/Users/hd/.openclaw/cron"
  if [[ -d "$cron_dir" ]]; then
    for state_file in "$cron_dir"/*.state.json; do
      [[ -f "$state_file" ]] || continue
      local name=$(basename "$state_file" .state.json)
      local consecutive_failures=$(jq -r '.consecutiveFailures // 0' "$state_file" 2>/dev/null || echo 0)
      local check_name="cron_${name}"
      
      if [[ "$consecutive_failures" -ge 3 ]]; then
        alert "Cron \`${name}\` has ${consecutive_failures} consecutive failures" "$check_name"
      else
        # Send recovery alert if this cron was previously failing
        recovery_alert "$check_name" "Cron \`${name}\` recovered (${consecutive_failures} failures)"
      fi
    done
  fi
  log "info" "Cron health check complete"
}

# ── B) Heartbeat Pileup ──
check_heartbeat_pileup() {
  local count=$(pgrep -f "openclaw.*heartbeat" 2>/dev/null | wc -l | tr -d ' ')
  local check_name="heartbeat_pileup"
  
  if [[ "$count" -gt 1 ]]; then
    alert "Heartbeat pileup detected: ${count} processes running" "$check_name"
  else
    recovery_alert "$check_name" "Heartbeat pileup resolved (${count} process)"
  fi
  log "info" "Heartbeat pileup check: ${count} processes"
}

# ── C) Tool Smoke Tests ──
check_tools() {
  log "info" "Fitness endpoint base: ${FITNESS_BASE_URL}"

  # gog
  local check_name="gog"
  gog_exit=0
  timeout 5 gog --account hameldesai3@gmail.com gmail search 'newer_than:1d' --max 1 2>/dev/null || gog_exit=$?
  if [[ "$gog_exit" -eq 4 ]]; then
    alert "gog needs re-auth (exit code 4 = no auth)" "$check_name"
  elif [[ "$gog_exit" -eq 124 ]]; then
    alert "gog timed out (possible auth/network issue)" "$check_name"
  elif [[ "$gog_exit" -ne 0 ]]; then
    alert "gog smoke test failed (exit $gog_exit)" "$check_name"
  else
    recovery_alert "$check_name" "gog recovered and is working"
    log "info" "gog: OK"
  fi

  # Tonal - this is the main target for suppression
  local tonal_check_name="tonal"
  local tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/tonal/health" 2>/dev/null || echo "000")
  if [[ "$tonal_code" != "200" ]]; then
    log "warning" "Tonal health check failed (HTTP ${tonal_code}), waiting for in-service refresh self-heal"
    sleep 5
    tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/tonal/health" 2>/dev/null || echo "000")
    if [[ "$tonal_code" != "200" ]]; then
      alert "Tonal still down after in-service self-heal (HTTP ${tonal_code})" "$tonal_check_name"
    else
      recovery_alert "$tonal_check_name" "Tonal self-healed successfully"
      log "info" "Tonal self-healed successfully"
    fi
  else
    recovery_alert "$tonal_check_name" "Tonal recovered and is healthy"
    log "info" "Tonal: OK"
  fi

  # Whoop
  local whoop_check_name="whoop"
  local whoop_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/whoop/data" 2>/dev/null || echo "000")
  if [[ "$whoop_code" != "200" ]]; then
    alert "Whoop health check failed (HTTP ${whoop_code})" "$whoop_check_name"
  else
    recovery_alert "$whoop_check_name" "Whoop recovered and is healthy"
    log "info" "Whoop: OK"
  fi

  # PostgreSQL
  local pg_check_name="postgresql"
  if ! psql cortana -c "SELECT 1;" &>/dev/null; then
    alert "PostgreSQL is DOWN" "$pg_check_name"
  else
    recovery_alert "$pg_check_name" "PostgreSQL recovered and is running"
    log "info" "PostgreSQL: OK"
  fi
}

# ── D) Budget Guard ──
check_budget() {
  local output
  output=$(node /Users/hd/clawd/skills/telegram-usage/handler.js json 2>/dev/null) || { log "warning" "Budget check failed to run"; return; }

  local day_of_month
  day_of_month=$(date +%d | sed 's/^0//')

  # Parse numeric quotaRemaining directly from JSON to avoid fragile text scraping
  local pct
  pct=$(echo "$output" | jq -r '.quotaRemaining // empty' 2>/dev/null || true)

  local budget_check_name="budget_low"

  if [[ -n "$pct" && "$pct" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    # pct = remaining quota (e.g., 100 = fully available, 0 = exhausted)
    local is_low
    is_low=$(echo "$pct" | awk '{print ($1 < 30) ? 1 : 0}')
    if [[ "$is_low" == "1" && "$day_of_month" -lt 20 ]]; then
      alert "API budget low: ~${pct}% quota remaining before day 20" "$budget_check_name"
    elif [[ "$is_low" == "1" ]]; then
      alert "API budget low: ~${pct}% quota remaining" "$budget_check_name"
    else
      recovery_alert "$budget_check_name" "API budget recovered: ${pct}% quota remaining"
      log "info" "Budget: ${pct}% quota remaining"
    fi
  else
    log "info" "Budget check: day ${day_of_month}, quota unknown (no reliable usage line)"
  fi
}

# ── Run all checks ──
echo "=== Watchdog run: $(date) ==="

check_cron_quarantine
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
