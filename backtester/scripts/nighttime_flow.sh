#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

NIGHTLY_LIMIT="${NIGHTLY_LIMIT:-20}"
SKIP_LIVE_PREFILTER_REFRESH="${SKIP_LIVE_PREFILTER_REFRESH:-0}"
REFRESH_SP500="${REFRESH_SP500:-0}"
JSON_OUTPUT="${JSON_OUTPUT:-0}"
MARKET_DATA_SERVICE_URL="${MARKET_DATA_SERVICE_URL:-http://localhost:3033}"
RUN_MARKET_DATA_OPS="${RUN_MARKET_DATA_OPS:-1}"
RUN_PREDICTION_ACCURACY="${RUN_PREDICTION_ACCURACY:-1}"

ARGS=(--limit "${NIGHTLY_LIMIT}")

if [[ "${SKIP_LIVE_PREFILTER_REFRESH}" == "1" ]]; then
  ARGS+=(--skip-live-prefilter-refresh)
fi

if [[ "${REFRESH_SP500}" == "1" ]]; then
  ARGS+=(--refresh-sp500)
fi

if [[ "${JSON_OUTPUT}" == "1" ]]; then
  ARGS+=(--json)
fi

echo "== Nighttime flow =="
echo "Running nightly discovery with limit=${NIGHTLY_LIMIT}"

(
  cd "${BACKTESTER_DIR}"
  uv run python nightly_discovery.py "${ARGS[@]}"
)

if [[ "${RUN_MARKET_DATA_OPS}" == "1" ]]; then
  echo
  echo "== Market data ops =="
  if ! curl -fsS "${MARKET_DATA_SERVICE_URL}/market-data/ops" \
    | (cd "${BACKTESTER_DIR}" && uv run python "${BACKTESTER_DIR}/scripts/local_output_formatter.py" --mode market-data-ops); then
    printf '%s\n' "Market data ops" "" "- Unable to reach ${MARKET_DATA_SERVICE_URL}/market-data/ops"
  fi
fi

if [[ "${RUN_PREDICTION_ACCURACY}" == "1" ]]; then
  echo
  echo "== Prediction accuracy =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python prediction_accuracy_report.py
  )
fi

source "${SCRIPT_DIR}/auto_commit_pr.sh"
auto_commit_pr "nighttime" "${RUN_STAMP}" "${REPO_ROOT}"
