#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/hd/Developer/cortana-external"
PKG_DIR="$ROOT/packages/market-intel"
MAX_ARTIFACT_AGE_HOURS="${MAX_ARTIFACT_AGE_HOURS:-8}"
MIN_TOP_MARKETS="${MIN_TOP_MARKETS:-1}"
MIN_WATCHLIST_COUNT="${MIN_WATCHLIST_COUNT:-1}"
MAX_FALLBACK_ONLY="${MAX_FALLBACK_ONLY:-2}"

cd "$PKG_DIR"
pnpm smoke
pnpm integrate
pnpm watchdog -- --max-age-hours "$MAX_ARTIFACT_AGE_HOURS" --min-top-markets "$MIN_TOP_MARKETS" --min-watchlist-count "$MIN_WATCHLIST_COUNT"
pnpm registry-audit -- --max-fallback-only "$MAX_FALLBACK_ONLY"
