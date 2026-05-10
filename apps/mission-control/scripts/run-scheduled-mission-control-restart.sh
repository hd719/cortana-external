#!/bin/bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: run-scheduled-mission-control-restart.sh LABEL PLIST_PATH DELAY_SECONDS LOG_PATH RESTART_SCRIPT RESTART_PATH [restart args...]

Internal worker for schedule-mission-control-restart.sh. It is launched by
launchd so it can survive Mission Control stopping its own process tree.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 6 ]]; then
  usage >&2
  exit 2
fi

label="$1"
plist_path="$2"
delay_seconds="$3"
log_path="$4"
restart_script="$5"
restart_path="$6"
shift 6

cleanup_plist() {
  rm -f "${plist_path}"
}
trap cleanup_plist EXIT

export PATH="${restart_path}"

if ! [[ "${delay_seconds}" =~ ^[0-9]+$ ]]; then
  echo "Delay must be a non-negative integer: ${delay_seconds}" >&2
  exit 2
fi

if [[ ! -x "${restart_script}" ]]; then
  echo "Restart script is missing or not executable: ${restart_script}" >&2
  exit 1
fi

sleep "${delay_seconds}"

{
  printf '[mission-control-restart-scheduler] started_at=%s delay_seconds=%s label=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${delay_seconds}" \
    "${label}"

  printf '[mission-control-restart-scheduler] command=%q' "${restart_script}"
  for arg in "$@"; do
    printf ' %q' "${arg}"
  done
  printf '\n'

  set +e
  "${restart_script}" "$@"
  exit_code=$?
  set -e

  printf '[mission-control-restart-scheduler] finished_at=%s exit_code=%s label=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${exit_code}" \
    "${label}"
} >>"${log_path}" 2>&1

launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || launchctl remove "${label}" >/dev/null 2>&1 || true

exit "${exit_code}"
