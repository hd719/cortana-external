#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

SYMBOL="${SYMBOL:-AAPL}"
YEARS="${YEARS:-2}"
STRATEGY="${STRATEGY:-momentum}"
CASH="${CASH:-10000}"
BENCHMARK="${BENCHMARK:-SPY}"
COMPARE="${COMPARE:-0}"

echo "== Backtest flow =="
echo "Symbol: ${SYMBOL}"
echo "Years: ${YEARS}"
echo "Cash: ${CASH}"
echo "Benchmark: ${BENCHMARK}"

if [[ "${COMPARE}" == "1" ]]; then
  echo "Mode: compare all momentum variants"
else
  echo "Strategy: ${STRATEGY}"
fi

echo
echo "Tip: this is a historical backtest, not the live daytime advisor flow."
echo

ARGS=(
  python
  main.py
  --symbol "${SYMBOL}"
  --years "${YEARS}"
  --cash "${CASH}"
  --benchmark "${BENCHMARK}"
)

if [[ "${COMPARE}" == "1" ]]; then
  ARGS+=(--compare)
else
  ARGS+=(--strategy "${STRATEGY}")
fi

(
  cd "${BACKTESTER_DIR}"
  uv run "${ARGS[@]}"
)

source "${SCRIPT_DIR}/auto_commit_pr.sh"
auto_commit_pr "backtest" "${RUN_STAMP}" "${REPO_ROOT}"

# Ex.
# SYMBOL=NVDA YEARS=2 ./scripts/backtest_flow.sh
# SYMBOL=MSFT YEARS=5 STRATEGY=aggressive ./scripts/backtest_flow.sh
# SYMBOL=AAPL YEARS=3 COMPARE=1 ./scripts/backtest_flow.sh
