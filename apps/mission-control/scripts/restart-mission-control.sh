#!/bin/bash

set -euo pipefail

RUNTIME_ENV="prod"
HEALTH_URL_OVERRIDE=""
BUILD=1

usage() {
  cat <<'EOF'
Usage: restart-mission-control.sh [--env prod|dev] [--skip-build] [--health-url URL]

Rebuilds the Mission Control app, restarts the launchd-managed service,
and waits for the health endpoint to return successfully.

Options:
  --env prod|dev    Restart the production service on 3000 or dev service on 3002
  --skip-build       Restart without running pnpm build first
  --skip-smoke       Deprecated no-op; legacy Trading Ops smoke no longer runs during restart
  --health-url URL   Override the health check URL
  -h, --help         Show this help text
EOF
}

log() {
  printf '[mission-control-restart] %s\n' "$*"
}

mission_control_related_pids() {
  local pid="" command="" cwd=""

  while IFS= read -r line; do
    pid="${line%% *}"
    command="${line#* }"
    [[ -z "${pid}" || -z "${command}" ]] && continue
    cwd="$(/usr/sbin/lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | awk '/^n/ {print substr($0, 2); exit}')"
    if [[ "${cwd}" == "${APP_DIR}" && "${command}" == *"--port ${PORT_VALUE}"* ]]; then
      printf '%s\n' "${pid}"
    fi
  done < <(
    ps -axo pid=,command= | awk '
      /next-server/ ||
      /next\/dist\/bin\/next start/ ||
      /[p]npm start/ {
        sub(/^[[:space:]]+/, "", $0);
        print $0;
      }
    '
  )
}

load_related_pids() {
  RELATED_PIDS=()
  local pid=""

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && RELATED_PIDS+=("${pid}")
  done < <(mission_control_related_pids | sort -u)
}

kill_pid_list() {
  local signal="$1"
  shift || true
  local pid=""

  for pid in "$@"; do
    [[ -n "${pid}" ]] && kill "-${signal}" "${pid}" 2>/dev/null || true
  done
}

wait_for_port_clear() {
  local attempts="${1:-10}"
  local listener_pids=""

  for _ in $(seq 1 "${attempts}"); do
    listener_pids="$(/usr/sbin/lsof -tiTCP:"${PORT_VALUE}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -z "${listener_pids}" ]]; then
      return 0
    fi
    sleep 1
  done

  return 1
}

wait_for_pids_clear() {
  local attempts="${1:-10}"
  local pid=""
  local still_running=0

  for _ in $(seq 1 "${attempts}"); do
    still_running=0
    for pid in "${RELATED_PIDS[@]:-}"; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        still_running=1
        break
      fi
    done
    if [[ "${still_running}" -eq 0 ]]; then
      return 0
    fi
    sleep 1
  done

  return 1
}

notify_failure() {
  local title="$1"
  local detail="$2"
  local guard="${TRADING_OPS_GUARD_BIN:-${CORTANA_REPO}/tools/notifications/telegram-delivery-guard.sh}"

  if [[ ! -x "${guard}" ]]; then
    echo "${title} ${detail}" >&2
    return 0
  fi

  "${guard}" \
    "$(printf '%s\n%s' "${title}" "${detail}")" \
    "8171372724" \
    "" \
    "mission_control:restart_failed" \
    "critical" \
    "monitor" \
    "Mission Control" \
    "now" \
    "restart-mission-control" >/dev/null 2>&1 || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ $# -lt 2 ]]; then
        echo "--env requires prod or dev" >&2
        exit 1
      fi
      RUNTIME_ENV="$2"
      shift 2
      ;;
    --skip-build)
      BUILD=0
      shift
      ;;
    --skip-smoke)
      log "--skip-smoke is deprecated; legacy Trading Ops smoke is already excluded from restart"
      shift
      ;;
    --health-url)
      if [[ $# -lt 2 ]]; then
        echo "--health-url requires a value" >&2
        exit 1
      fi
      HEALTH_URL_OVERRIDE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl is required but was not found in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
DEV_ROOT="$(cd "${REPO_ROOT}/.." && pwd)"
CORTANA_REPO="${CORTANA_SOURCE_REPO:-${DEV_ROOT}/cortana}"

case "${RUNTIME_ENV}" in
  prod)
    SERVICE_LABEL="com.cortana.mission-control"
    PORT_VALUE="3000"
    MARKET_LAB_ENV_VALUE="prod"
    ;;
  dev)
    SERVICE_LABEL="com.cortana.mission-control-dev"
    PORT_VALUE="3002"
    MARKET_LAB_ENV_VALUE="dev"
    ;;
  *)
    echo "--env must be prod or dev" >&2
    exit 1
    ;;
esac

PLIST_PATH="${HOME}/Library/LaunchAgents/${SERVICE_LABEL}.plist"
HEALTH_URL="${HEALTH_URL_OVERRIDE:-${MISSION_CONTROL_HEALTH_URL:-http://127.0.0.1:${PORT_VALUE}/api/heartbeat-status}}"
export PORT="${PORT_VALUE}"
export MARKET_LAB_ENV="${MARKET_LAB_ENV_VALUE}"
export MISSION_CONTROL_RUNTIME_ENV="${RUNTIME_ENV}"

if [[ ! -f "${PLIST_PATH}" ]]; then
  log "LaunchAgent plist missing at ${PLIST_PATH}; it will be recreated."
fi

if [[ "${BUILD}" -eq 1 ]]; then
  log "Building Mission Control in ${APP_DIR}"
  if ! (
    cd "${APP_DIR}"
    pnpm build
  ); then
    notify_failure "Mission Control build failed during restart." "Run ./restart-mission-control.sh locally and inspect the build output."
    exit 1
  fi
else
  log "Skipping build"
fi

log "Installing direct Mission Control LaunchAgent"
installed_plist="$(
  cd "${APP_DIR}"
  pnpm exec tsx scripts/install-launch-agent.ts --env "${RUNTIME_ENV}"
)"
PLIST_PATH="${installed_plist}"

log "Stopping existing Mission Control processes"
launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null || true
launchctl remove "${SERVICE_LABEL}" 2>/dev/null || true

listener_pids="$(/usr/sbin/lsof -tiTCP:"${PORT_VALUE}" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "${listener_pids}" ]]; then
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done <<< "${listener_pids}"
fi

load_related_pids
if [[ "${#RELATED_PIDS[@]}" -gt 0 ]]; then
  kill_pid_list TERM "${RELATED_PIDS[@]}"
fi

if ! wait_for_port_clear 10 || ! wait_for_pids_clear 5; then
  log "Mission Control processes are still alive after graceful stop; forcing remaining processes down"
  if [[ -n "${listener_pids:-}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] && kill -9 "${pid}" 2>/dev/null || true
    done <<< "${listener_pids}"
  fi
  if [[ "${#RELATED_PIDS[@]}" -gt 0 ]]; then
    kill_pid_list KILL "${RELATED_PIDS[@]}"
  fi
  wait_for_port_clear 5 || {
    echo "Mission Control restart aborted because port ${PORT_VALUE} never cleared." >&2
    exit 1
  }
  wait_for_pids_clear 5 || {
    echo "Mission Control restart aborted because stale Mission Control processes never exited." >&2
    exit 1
  }
fi

log "Starting ${SERVICE_LABEL} via launchd"
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}"

log "Waiting for Mission Control health check at ${HEALTH_URL}"
for _ in $(seq 1 20); do
  if response="$(curl -fsS "${HEALTH_URL}" 2>/dev/null)"; then
    log "Mission Control is healthy"
    printf '%s\n' "${response}"
    exit 0
  fi
  sleep 1
done

echo "Mission Control restart completed, but the health check did not pass: ${HEALTH_URL}" >&2
notify_failure "Mission Control restart health check failed." "Health endpoint did not recover after restart: ${HEALTH_URL}"
exit 1
