#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"

CANSLIM_LIMIT="${CANSLIM_LIMIT:-8}"
CANSLIM_MIN_SCORE="${CANSLIM_MIN_SCORE:-6}"
DIPBUYER_LIMIT="${DIPBUYER_LIMIT:-8}"
DIPBUYER_MIN_SCORE="${DIPBUYER_MIN_SCORE:-6}"
DEEP_DIVE_SYMBOL="${DEEP_DIVE_SYMBOL:-NVDA}"
QUICK_CHECK_SYMBOL="${QUICK_CHECK_SYMBOL:-BTC}"
RUN_MARKET_INTEL="${RUN_MARKET_INTEL:-1}"
MARKET_INTEL_CMD="${MARKET_INTEL_CMD:-./tools/market-intel/run_market_intel.sh}"
RUN_DEEP_DIVE="${RUN_DEEP_DIVE:-0}"
REVIEW_DETAIL_LIMIT="${REVIEW_DETAIL_LIMIT:-50}"
LOCAL_OUTPUT_FORMATTER="${LOCAL_OUTPUT_FORMATTER:-${BACKTESTER_DIR}/scripts/local_output_formatter.py}"
LOCAL_RUNS_ROOT="${LOCAL_RUNS_ROOT:-${BACKTESTER_DIR}/var/local-workflows}"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"
LOCAL_RUN_DIR="${LOCAL_RUNS_ROOT}/${RUN_STAMP}"
LEADER_BASKET_PATH="${LEADER_BASKET_PATH:-${BACKTESTER_DIR}/.cache/leader_baskets/leader-baskets-latest.json}"

mkdir -p "${LOCAL_RUN_DIR}"

run_formatted_section() {
  local label="$1"
  local slug="$2"
  local mode="$3"
  shift 3

  local raw_path="${LOCAL_RUN_DIR}/${slug}-raw.txt"
  local view_path="${LOCAL_RUN_DIR}/${slug}.txt"

  echo
  echo "== ${label} =="
  (
    cd "${BACKTESTER_DIR}"
    "$@" >"${raw_path}" 2>&1
  )
  if [[ "${mode}" == "alert" && -f "${LEADER_BASKET_PATH}" ]]; then
    uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode "${mode}" --leader-basket-path "${LEADER_BASKET_PATH}" <"${raw_path}" >"${view_path}"
  else
    uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode "${mode}" <"${raw_path}" >"${view_path}"
  fi
  cat "${view_path}"
}

echo "== Daytime flow =="

if [[ "${RUN_MARKET_INTEL}" == "1" ]]; then
  echo
  echo "== Refreshing market context (SPY regime + Polymarket) =="
  (
    cd "${REPO_ROOT}"
    "${MARKET_INTEL_CMD}"
  )
else
  echo
  echo "== Skipping market context refresh (RUN_MARKET_INTEL=0) =="
fi

echo
echo "== Checking market regime =="
(
  cd "${BACKTESTER_DIR}"
  uv run python advisor.py --market | tee "${LOCAL_RUN_DIR}/market-regime.txt"
)

echo
echo "== Leader buckets =="
if [[ -f "${LEADER_BASKET_PATH}" ]]; then
  cp "${LEADER_BASKET_PATH}" "${LOCAL_RUN_DIR}/leader-baskets-raw.json"
  uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode leader-baskets \
    <"${LEADER_BASKET_PATH}" \
    >"${LOCAL_RUN_DIR}/leader-baskets.txt"
  cat "${LOCAL_RUN_DIR}/leader-baskets.txt"
else
  printf '%s\n' "Leader buckets" "" "- Leader basket artifact is missing. Run ./scripts/nighttime_flow.sh first." \
    | tee "${LOCAL_RUN_DIR}/leader-baskets.txt"
fi

run_formatted_section \
  "Running CANSLIM alert" \
  "canslim-alert" \
  "alert" \
  uv run python canslim_alert.py \
    --limit "${CANSLIM_LIMIT}" \
    --min-score "${CANSLIM_MIN_SCORE}" \
    --review-detail-limit "${REVIEW_DETAIL_LIMIT}"

run_formatted_section \
  "Running Dip Buyer alert" \
  "dipbuyer-alert" \
  "alert" \
  uv run python dipbuyer_alert.py \
    --limit "${DIPBUYER_LIMIT}" \
    --min-score "${DIPBUYER_MIN_SCORE}" \
    --review-detail-limit "${REVIEW_DETAIL_LIMIT}"

if [[ "${RUN_DEEP_DIVE}" == "1" ]]; then
  echo
  echo "== Deep dive: ${DEEP_DIVE_SYMBOL} =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python advisor.py --symbol "${DEEP_DIVE_SYMBOL}"
  )
fi

echo
echo "== Quick check: ${QUICK_CHECK_SYMBOL} =="
(
  cd "${BACKTESTER_DIR}"
  PYTHONWARNINGS=ignore uv run python advisor.py --quick-check "${QUICK_CHECK_SYMBOL}" \
    >"${LOCAL_RUN_DIR}/quick-check-raw.txt" 2>&1
)
uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode quick-check \
  <"${LOCAL_RUN_DIR}/quick-check-raw.txt" \
  >"${LOCAL_RUN_DIR}/quick-check.txt"
cat "${LOCAL_RUN_DIR}/quick-check.txt"

echo
echo "Saved local run outputs: ${LOCAL_RUN_DIR}"

# Auto-commit workflow outputs on a branch and open a PR
source "${SCRIPT_DIR}/auto_commit_pr.sh"
auto_commit_pr "daytime" "${RUN_STAMP}" "${REPO_ROOT}"
