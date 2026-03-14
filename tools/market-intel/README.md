# Market Intel Integration

This is the production integration bridge between the TypeScript Polymarket intelligence package and the existing Python stock-analysis pipeline.

## What it does

`run_market_intel.sh`:
- runs the live smoke check
- builds the Polymarket report
- persists history
- prunes old history snapshots
- writes operator artifacts under `/Users/hd/Developer/cortana-external/var/market-intel/polymarket`
- exports a watchlist file to `/Users/hd/Developer/cortana-external/backtester/data/polymarket_watchlist.json`
- enforces artifact freshness and registry health thresholds

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

Useful direct commands:

```bash
cd /Users/hd/Developer/cortana-external/packages/market-intel
pnpm watchdog -- --max-age-hours 8 --min-top-markets 1 --min-watchlist-count 1
pnpm registry-audit -- --max-fallback-only 2
```

Environment overrides for the wrapper:
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
