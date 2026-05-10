#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTART_SCRIPT="${SCRIPT_DIR}/restart-mission-control.sh"
WORKER_SCRIPT="${SCRIPT_DIR}/run-scheduled-mission-control-restart.sh"
LOG_PATH="${MISSION_CONTROL_RESTART_LOG:-/tmp/mission-control-restart.log}"
DELAY_SECONDS="${MISSION_CONTROL_RESTART_DELAY_SECONDS:-3}"
LABEL_PREFIX="com.cortana.mission-control.scheduled-restart"

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

if [[ ! -x "${WORKER_SCRIPT}" ]]; then
  echo "Scheduled restart worker is missing or not executable: ${WORKER_SCRIPT}" >&2
  exit 1
fi

if ! [[ "${DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "MISSION_CONTROL_RESTART_DELAY_SECONDS must be a non-negative integer." >&2
  exit 1
fi

mkdir -p "$(dirname "${LOG_PATH}")"

uid="$(id -u)"
label="${LABEL_PREFIX}.$(date +%s).$$"
plist_path="/tmp/${label}.plist"

while IFS= read -r stale_label; do
  [[ -z "${stale_label}" || "${stale_label}" == "${label}" ]] && continue
  launchctl bootout "gui/${uid}/${stale_label}" >/dev/null 2>&1 || true
  launchctl remove "${stale_label}" >/dev/null 2>&1 || true
done < <(launchctl list | awk -v prefix="${LABEL_PREFIX}" 'index($3, prefix) == 1 { print $3 }')

xml_escape() {
  local value="${1}"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf "%s" "${value}"
}

write_arg() {
  printf "    <string>%s</string>\n" "$(xml_escape "$1")"
}

{
  cat <<PLIST_HEADER
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "${label}")</string>
  <key>ProgramArguments</key>
  <array>
PLIST_HEADER
  write_arg "${WORKER_SCRIPT}"
  write_arg "${label}"
  write_arg "${plist_path}"
  write_arg "${DELAY_SECONDS}"
  write_arg "${LOG_PATH}"
  write_arg "${RESTART_SCRIPT}"
  write_arg "${PATH}"
  for arg in "$@"; do
    write_arg "${arg}"
  done
  cat <<PLIST_FOOTER
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "${LOG_PATH}")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "${LOG_PATH}")</string>
</dict>
</plist>
PLIST_FOOTER
} >"${plist_path}"

plutil -lint "${plist_path}" >/dev/null
launchctl bootstrap "gui/${uid}" "${plist_path}"

printf "[mission-control-restart-scheduler] scheduled label=%s delay_seconds=%s log=%s\n" "${label}" "${DELAY_SECONDS}" "${LOG_PATH}"
