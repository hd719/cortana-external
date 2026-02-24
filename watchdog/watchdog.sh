#!/bin/bash
# Cortana Watchdog — runs every 15 min via launchd
# Pure shell, $0 cost, no AI involved

set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/heartbeat_classifier.sh"

BOT_TOKEN="$(cat /Users/hd/.openclaw/openclaw.json | jq -r '.channels.telegram.botToken')"
CHAT_ID="8171372724"
SLACK_WEBHOOK_URL="${WATCHDOG_SLACK_WEBHOOK_URL:-}"
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
  local severity="${3:-warning}"

  if should_suppress_alert "$check_name"; then
    log "info" "Suppressed repeated alert: $msg"
    return
  fi

  local icon="⚠️"
  if [[ "$severity" == "critical" ]]; then
    icon="🚨"
  fi

  ALERTS="${ALERTS}${icon} ${msg}\n"
  log "$severity" "$msg"
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

record_heartbeat_observation() {
  local current_time="$1"
  local pid="$2"
  local age_seconds="$3"
  local state
  state=$(load_state)

  state=$(echo "$state" | jq --argjson now "$current_time" --arg pid "$pid" --argjson age "$age_seconds" '
    .heartbeat_monitor.last_seen_at = $now |
    .heartbeat_monitor.last_pid = $pid |
    .heartbeat_monitor.last_age = $age |
    .heartbeat_monitor.last_status = "observed"
  ')

  save_state "$state"
}

get_heartbeat_monitor_value() {
  local field="$1"
  local state
  state=$(load_state)
  echo "$state" | jq -r ".heartbeat_monitor.${field} // empty" 2>/dev/null || true
}

track_heartbeat_restart() {
  local current_time="$1"
  local state
  state=$(load_state)
  state=$(echo "$state" | jq --argjson now "$current_time" '
    .heartbeat_monitor.restarts = ((.heartbeat_monitor.restarts // []) + [$now])
    | .heartbeat_monitor.restarts = (.heartbeat_monitor.restarts | map(select(. >= ($now - 21600))))
  ')
  save_state "$state"
}

get_heartbeat_restarts_6h() {
  local current_time="$1"
  local state
  state=$(load_state)
  echo "$state" | jq -r --argjson now "$current_time" '
    ((.heartbeat_monitor.restarts // []) | map(select(. >= ($now - 21600))) | length)
  ' 2>/dev/null || echo "0"
}

send_alert_notifications() {
  local msg="$1"

  # canonical channel in this repo is Telegram via OpenClaw bot token
  "$SCRIPT_DIR/send_telegram.sh" "$BOT_TOKEN" "$CHAT_ID" "$msg"

  # optional Slack bridge (if explicitly configured)
  if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
    curl -s -X POST -H 'Content-type: application/json' \
      --data "$(jq -nc --arg text "$(echo -e "$msg" | sed 's/\*//g')" '{text:$text}')" \
      "$SLACK_WEBHOOK_URL" >/dev/null || true
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
    alert "Cron \`${name}\` is quarantined (${reason})" "cron_quarantine_${name}" "critical"
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
        alert "Cron \`${name}\` has ${consecutive_failures} consecutive failures" "$check_name" "warning"
      else
        # Send recovery alert if this cron was previously failing
        recovery_alert "$check_name" "Cron \`${name}\` recovered (${consecutive_failures} failures)"
      fi
    done
  fi
  log "info" "Cron health check complete"
}

# ── B) Heartbeat Health (variance + degradation) ──
check_heartbeat_health() {
  local check_name="heartbeat_health"
  local count
  count=$(pgrep -f "openclaw.*heartbeat" 2>/dev/null | wc -l | tr -d ' ')
  local current_time
  current_time=$(get_current_timestamp)

  local pid=""
  local age_seconds=0
  local variance_seconds=0

  if [[ "$count" -eq 1 ]]; then
    pid=$(pgrep -f "openclaw.*heartbeat" 2>/dev/null | head -n 1 | tr -d ' ')
    age_seconds=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
    age_seconds="${age_seconds:-0}"

    local prev_pid
    prev_pid=$(get_heartbeat_monitor_value "last_pid")
    local prev_age
    prev_age=$(get_heartbeat_monitor_value "last_age")
    local prev_seen
    prev_seen=$(get_heartbeat_monitor_value "last_seen_at")

    if [[ -n "$prev_pid" && "$prev_pid" != "$pid" ]]; then
      track_heartbeat_restart "$current_time"
    fi

    if [[ -n "$prev_age" && -n "$prev_seen" && "$prev_pid" == "$pid" ]]; then
      local observed_delta=$((age_seconds - prev_age))
      local expected_delta=$((current_time - prev_seen))
      if [[ "$observed_delta" -lt 0 ]]; then
        observed_delta=0
      fi
      local drift=$((observed_delta - expected_delta))
      if [[ "$drift" -lt 0 ]]; then
        drift=$((drift * -1))
      fi
      variance_seconds="$drift"
    fi

    record_heartbeat_observation "$current_time" "$pid" "$age_seconds"
  fi

  local restarts_6h
  restarts_6h=$(get_heartbeat_restarts_6h "$current_time")

  local classification
  classification=$(classify_heartbeat_health "$count" "$age_seconds" "$restarts_6h" "$variance_seconds")
  local severity="${classification%%|*}"
  local reason="${classification#*|}"

  if [[ "$severity" == "critical" ]]; then
    alert "Heartbeat degraded (critical): ${reason}" "$check_name" "critical"
  elif [[ "$severity" == "warning" ]]; then
    alert "Heartbeat degraded (warning): ${reason}" "$check_name" "warning"
  else
    recovery_alert "$check_name" "Heartbeat health recovered (stable)"
    log "info" "Heartbeat healthy: count=${count}, age=${age_seconds}s, restarts_6h=${restarts_6h}, variance=${variance_seconds}s"
  fi
}

# ── C) Tool Smoke Tests ──
check_tools() {
  log "info" "Fitness endpoint base: ${FITNESS_BASE_URL}"

  # gog
  local check_name="gog"
  gog_exit=0
  timeout 5 gog --account hameldesai3@gmail.com gmail search 'newer_than:1d' --max 1 2>/dev/null || gog_exit=$?
  if [[ "$gog_exit" -eq 4 ]]; then
    alert "gog needs re-auth (exit code 4 = no auth)" "$check_name" "warning"
  elif [[ "$gog_exit" -eq 124 ]]; then
    alert "gog timed out (possible auth/network issue)" "$check_name" "warning"
  elif [[ "$gog_exit" -ne 0 ]]; then
    alert "gog smoke test failed (exit $gog_exit)" "$check_name" "warning"
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
      alert "Tonal still down after in-service self-heal (HTTP ${tonal_code})" "$tonal_check_name" "warning"
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
    alert "Whoop health check failed (HTTP ${whoop_code})" "$whoop_check_name" "warning"
  else
    recovery_alert "$whoop_check_name" "Whoop recovered and is healthy"
    log "info" "Whoop: OK"
  fi

  # PostgreSQL
  local pg_check_name="postgresql"
  if ! psql cortana -c "SELECT 1;" &>/dev/null; then
    alert "PostgreSQL is DOWN" "$pg_check_name" "critical"
  else
    recovery_alert "$pg_check_name" "PostgreSQL recovered and is running"
    log "info" "PostgreSQL: OK"
  fi
}

check_degraded_agents() {
  local table_name
  table_name=$(psql cortana -tAc "SELECT CASE WHEN to_regclass('public.agents') IS NOT NULL THEN 'agents' WHEN to_regclass('public.agent') IS NOT NULL THEN 'agent' ELSE '' END;" 2>/dev/null | xargs)

  if [[ -z "$table_name" ]]; then
    log "info" "Degraded-agent check skipped (no agent table found)"
    return
  fi

  local degraded_json
  degraded_json=$(psql cortana -tAc "SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) FROM (SELECT id::text, name, status::text, EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen, NOW())))::int AS stale_seconds FROM ${table_name} WHERE status::text IN ('degraded','offline') OR (last_seen IS NOT NULL AND last_seen < NOW() - INTERVAL '45 minutes')) t;" 2>/dev/null || echo "[]")

  local active_keys=()
  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    local id name status stale
    id=$(echo "$row" | jq -r '.id')
    name=$(echo "$row" | jq -r '.name // .id')
    status=$(echo "$row" | jq -r '.status')
    stale=$(echo "$row" | jq -r '.stale_seconds')

    local severity="warning"
    if [[ "$status" == "offline" || "$stale" -gt 7200 ]]; then
      severity="critical"
    fi

    local check_name="agent_degraded_${id}"
    active_keys+=("$check_name")
    alert "Agent degraded: ${name} (status=${status}, stale=${stale}s)" "$check_name" "$severity"
  done < <(echo "$degraded_json" | jq -c '.[]' 2>/dev/null)

  # recover any previously failing degraded-agent checks no longer active
  local state
  state=$(load_state)
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    local still_active="0"
    for a in "${active_keys[@]:-}"; do
      if [[ "$a" == "$key" ]]; then
        still_active="1"
        break
      fi
    done

    if [[ "$still_active" == "0" ]]; then
      local recovered_agent="${key#agent_degraded_}"
      recovery_alert "$key" "Agent recovered: ${recovered_agent}"
    fi
  done < <(echo "$state" | jq -r 'keys[] | select(startswith("agent_degraded_"))' 2>/dev/null)
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
      alert "API budget low: ~${pct}% quota remaining before day 20" "$budget_check_name" "warning"
    elif [[ "$is_low" == "1" ]]; then
      alert "API budget low: ~${pct}% quota remaining" "$budget_check_name" "warning"
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
check_heartbeat_health
check_tools
check_degraded_agents
check_budget

# ── Send alerts if any ──
if [[ -n "$ALERTS" ]]; then
  MSG="🐕 *Watchdog Alert*\n\n${ALERTS}\n_$(date '+%H:%M %b %d')_"
  send_alert_notifications "$(echo -e "$MSG")"
  log "info" "Alerts sent to notification channels"
fi

echo "=== Watchdog complete ==="
