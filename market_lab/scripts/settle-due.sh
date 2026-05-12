#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${MARKET_LAB_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOG_DIR="${MARKET_LAB_LOG_DIR:-$REPO_ROOT/.cache/market_lab/logs}"

mkdir -p "$LOG_DIR"

if [[ "${MARKET_LAB_SETTLE_WEEKDAYS_ONLY:-1}" == "1" ]]; then
  day_of_week="$(date +%u)"
  if [[ "$day_of_week" -gt 5 ]]; then
    echo "[$(date -Iseconds)] Market Lab settle-due skipped outside weekdays."
    exit 0
  fi
fi

cd "$REPO_ROOT"

{
  echo "[$(date -Iseconds)] Market Lab settle-due starting."
  uv run --project market_lab python -m market_lab.cli settle-due --json
  echo "[$(date -Iseconds)] Market Lab settle-due finished."
} >> "$LOG_DIR/settle-due.log" 2>&1
