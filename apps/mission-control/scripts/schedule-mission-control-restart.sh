#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTART_SCRIPT="${SCRIPT_DIR}/restart-mission-control.sh"
LOG_PATH="${MISSION_CONTROL_RESTART_LOG:-/tmp/mission-control-restart.log}"
DELAY_SECONDS="${MISSION_CONTROL_RESTART_DELAY_SECONDS:-3}"

usage() {
  cat <<USAGE
Usage: schedule-mission-control-restart.sh [restart-mission-control args...]

Schedules a detached Mission Control restart and returns immediately. Use this
from Mission Control /sessions so the active Codex request can finish before the
Mission Control process is stopped.

Environment:
  MISSION_CONTROL_RESTART_LOG             Log file path. Default: /tmp/mission-control-restart.log
  MISSION_CONTROL_RESTART_DELAY_SECONDS   Delay before restart. Default: 3
USAGE
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ ! -x "${RESTART_SCRIPT}" ]]; then
  echo "Restart script is missing or not executable: ${RESTART_SCRIPT}" >&2
  exit 1
fi

if ! [[ "${DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "MISSION_CONTROL_RESTART_DELAY_SECONDS must be a non-negative integer." >&2
  exit 1
fi

mkdir -p "$(dirname "${LOG_PATH}")"

(
  sleep "${DELAY_SECONDS}"
  {
    printf "[mission-control-restart-scheduler] started_at=%s delay_seconds=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DELAY_SECONDS}"
    printf "[mission-control-restart-scheduler] command=%q" "${RESTART_SCRIPT}"
    for arg in "$@"; do
      printf " %q" "${arg}"
    done
    printf "\n"
    exec "${RESTART_SCRIPT}" "$@"
  } >>"${LOG_PATH}" 2>&1
) </dev/null >/dev/null 2>&1 &

child_pid="$!"
disown "${child_pid}" 2>/dev/null || true

printf "[mission-control-restart-scheduler] scheduled pid=%s delay_seconds=%s log=%s\n" "${child_pid}" "${DELAY_SECONDS}" "${LOG_PATH}"
