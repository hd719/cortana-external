# Market Intel Integration

This is the production integration bridge between the TypeScript Polymarket intelligence package and the existing Python stock-analysis pipeline.

## What it does

`run_market_intel.sh`:
- refreshes the Python market-regime snapshot first via `backtester/data/market_regime.py`
- runs the live smoke check
- builds the Polymarket report
- persists history
- prunes old history snapshots
- writes operator artifacts under `/Users/hd/Developer/cortana-external/var/market-intel/polymarket`
- exports a watchlist file to `/Users/hd/Developer/cortana-external/backtester/data/polymarket_watchlist.json`
- enforces artifact freshness, regime freshness, overlay population, and registry health thresholds
- verifies the Python bridge can read the latest compact context and watchlist artifacts
- carries structured posture, divergence, and cross-asset watchlist bucket data into the Python alert layer

Artifacts written:
- `latest-report.json`
- `latest-compact.txt`
- `latest-verbose.txt`
- `latest-watchlist.json`

## Manual run

```bash
cd /Users/hd/Developer/cortana-external
./tools/market-intel/run_market_intel.sh
```

This is the single production health path. It verifies, in order:
1. a fresh SPY regime snapshot exists
2. Polymarket artifacts are rebuilt
3. overlay is populated when regime data is available
4. Python can read the compact context and watchlist artifacts
5. only then should CANSLIM / Dip Buyer alerts run

The exported watchlist is intentionally split by asset class:
- stock / ETF / crypto-proxy names can feed the Python stock universe
- direct crypto symbols stay in the contextual artifact only and are surfaced in alert focus lines instead of entering the stock screener

Useful direct commands:

```bash
cd /Users/hd/Developer/cortana-external/packages/market-intel
pnpm watchdog -- --regime /Users/hd/Developer/cortana-external/.cache/market_regime_snapshot_SPY.json --require-regime --max-age-hours 8 --min-top-markets 1 --min-watchlist-count 1
pnpm registry-audit -- --max-fallback-only 2
```

Environment overrides for the wrapper:
- `BACKTESTER_DIR`
- `PYTHON_BIN`
- `REGIME_PATH`
- `BRIDGE_VERIFY_SCRIPT`
- `MAX_ARTIFACT_AGE_HOURS`
- `MIN_TOP_MARKETS`
- `MIN_WATCHLIST_COUNT`
- `MAX_FALLBACK_ONLY`

## Example OpenClaw cron

```bash
openclaw cron create \
  --name "market-intel-polymarket-830am" \
  --schedule "30 8 * * 1-5" \
  --command "cd /Users/hd/Developer/cortana-external && ./tools/market-intel/run_market_intel.sh"
```

Run this before CANSLIM/Dip Buyer alert jobs so the Python alert formatters can consume the latest artifact files.
