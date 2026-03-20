#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

MINIMUM_SAMPLES="${MINIMUM_SAMPLES:-20}"
ATTRIBUTION_HORIZON="${ATTRIBUTION_HORIZON:-5d}"
SETTLE_FIRST="${SETTLE_FIRST:-1}"
BUILD_CALIBRATION="${BUILD_CALIBRATION:-1}"
BUILD_OVERLAY_PROMOTIONS="${BUILD_OVERLAY_PROMOTIONS:-1}"

echo "== Experimental maintenance flow =="

if [[ "${SETTLE_FIRST}" == "1" ]]; then
  echo
  echo "== Settling prior experimental snapshots =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python experimental_alpha.py --settle
  )
fi

if [[ "${BUILD_CALIBRATION}" == "1" ]]; then
  echo
  echo "== Building buy-decision calibration artifact =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python buy_decision_calibration.py --minimum-samples "${MINIMUM_SAMPLES}"
  )
fi

if [[ "${BUILD_OVERLAY_PROMOTIONS}" == "1" ]]; then
  echo
  echo "== Building overlay attribution and promotion state =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python experimental_alpha.py \
      --overlay-attribution \
      --evaluate-promotions \
      --minimum-samples "${MINIMUM_SAMPLES}" \
      --attribution-horizon "${ATTRIBUTION_HORIZON}"
  )
fi

source "${SCRIPT_DIR}/auto_commit_pr.sh"
auto_commit_pr "experimental-maintenance" "${RUN_STAMP}" "${REPO_ROOT}"

