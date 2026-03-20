#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

EXPERIMENTAL_SYMBOLS="${EXPERIMENTAL_SYMBOLS:-NVDA,BTC,COIN}"
JSON_OUTPUT="${JSON_OUTPUT:-0}"
PERSIST_SNAPSHOT="${PERSIST_SNAPSHOT:-1}"

ARGS=(--symbols "${EXPERIMENTAL_SYMBOLS}")

if [[ "${JSON_OUTPUT}" == "1" ]]; then
  ARGS+=(--json)
fi

echo "== Experimental research report =="
echo "Symbols: ${EXPERIMENTAL_SYMBOLS}"

(
  cd "${BACKTESTER_DIR}"
  uv run python experimental_alpha.py "${ARGS[@]}"
)

if [[ "${PERSIST_SNAPSHOT}" == "1" ]]; then
  echo
  echo "== Persisting experimental snapshot =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python experimental_alpha.py --persist
  )
fi

source "${SCRIPT_DIR}/auto_commit_pr.sh"
auto_commit_pr "experimental-report" "${RUN_STAMP}" "${REPO_ROOT}"

