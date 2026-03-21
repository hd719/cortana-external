# Backtester

Python trading-analysis engine for:
- CANSLIM-style breakout review
- Dip Buyer scans
- market-regime-aware decision support
- nightly discovery and watchlist refresh
- paper-only research and calibration

This README is the operator manual.

Use the study guide when you want to understand the system conceptually:
- [Backtester Study Guide](./docs/backtester-study-guide.md)
- [Roadmap](./docs/roadmap.md)
- [Session Handoff](./docs/session-handoff.md)

Other useful docs:
- [Polymarket + backtester flow](./docs/polymarket-backtester-flow.md)
- [Wave buildout overview](./docs/docs-wave-overview.md)
- [Decision review loop](./docs/decision-review-loop.md)
- [Scoring and calibration notes](./docs/scoring-calibration.md)
- [Uncertainty/confidence PRD](./docs/uncertainty-confidence-prd.md)
- [Uncertainty runtime wiring](./docs/uncertainty-confidence-runtime-wiring.md)

## Setup

Fresh clone:

```bash
# Install uv once if needed
curl -LsSf https://astral.sh/uv/install.sh | sh

cd /Users/hd/Developer/cortana-external/backtester
uv python install
uv venv .venv
source .venv/bin/activate
uv pip sync requirements.txt
```

Start the local TS market-data service in a separate terminal:

```bash
cd /Users/hd/Developer/cortana-external/apps/external-service
pnpm install
pnpm start
```

Optional Polymarket context:

```bash
cd /Users/hd/Developer/cortana-external
pnpm install
./tools/market-intel/run_market_intel.sh
```

Important notes:
- Alpaca keys are no longer required for normal backtester runs
- the Python engine now reads external market data through the local TS service
- default runtime order is `Schwab -> Yahoo (inside TS) -> Python cache`
- FRED, CBOE, and the base-universe artifact are also owned by the TS service
- Alpaca is no longer part of the default runtime chain; use it only for explicit compare/diagnostic checks
- Polymarket integration is read-only
- if you skip Polymarket refresh, the Python backtester still runs

## Start Here

Most useful first commands:

```bash
cd /Users/hd/Developer/cortana-external/backtester

# Market regime only
uv run python advisor.py --market

# Full analysis for one stock
uv run python advisor.py --symbol NVDA

# Fast verdict for one stock / proxy / coin
uv run python advisor.py --quick-check BTC

# Compact CANSLIM and Dip Buyer summaries
uv run python canslim_alert.py --limit 8 --min-score 6
uv run python dipbuyer_alert.py --limit 8 --min-score 6

# Broader overnight discovery
uv run python nightly_discovery.py --limit 20
```

## Workflow Wrappers

From [backtester](.):

```bash
# Daytime operator flow: context refresh, regime, alerts, quick check
./scripts/daytime_flow.sh

# Nighttime discovery flow: broader scan and cache refresh
./scripts/nighttime_flow.sh

# Historical strategy backtest flow
./scripts/backtest_flow.sh

# Paper-only experimental report + optional snapshot persist
./scripts/experimental_report_flow.sh

# Settle old research snapshots and rebuild calibration artifacts
./scripts/experimental_maintenance_flow.sh
```

Common overrides:

```bash
# Backtest NVIDIA over 3 years with the default momentum strategy
SYMBOL=NVDA YEARS=3 ./scripts/backtest_flow.sh

# Compare the built-in momentum variants on AAPL over 2 years
SYMBOL=AAPL YEARS=2 COMPARE=1 ./scripts/backtest_flow.sh

# Skip the Polymarket/context refresh during daytime flow
RUN_MARKET_INTEL=0 ./scripts/daytime_flow.sh

# Change the quick-check symbol
QUICK_CHECK_SYMBOL=NVDA ./scripts/daytime_flow.sh

# Include a full stock deep dive in daytime flow
RUN_DEEP_DIVE=1 DEEP_DIVE_SYMBOL=AAPL ./scripts/daytime_flow.sh

# Nighttime report only, no live prefilter refresh
SKIP_LIVE_PREFILTER_REFRESH=1 ./scripts/nighttime_flow.sh

# Broader nightly scan
NIGHTLY_LIMIT=30 ./scripts/nighttime_flow.sh

# Pick which leader-bucket window feeds soft priority
TRADING_LEADER_BASKET_PRIORITY_WINDOW=weekly ./scripts/daytime_flow.sh
```

## When To Run Each Script

Use this as the default operator cadence:

- `./scripts/daytime_flow.sh`
  - run during market hours when you want the current regime, live bucket context, CANSLIM, Dip Buyer, and a quick-check in one local view
  - best for `pre-market`, `morning`, `midday`, or `late afternoon` spot checks
- `./scripts/nighttime_flow.sh`
  - run after market close or overnight
  - use it to refresh the next day’s inputs, rebuild leader buckets, and persist nightly research artifacts
- `./scripts/backtest_flow.sh`
  - run when you want to test a strategy on past data instead of reading the live operator flow
  - best for idea validation, not live decisions
- `./scripts/experimental_report_flow.sh`
  - run only when you want extra paper-only research ideas for a custom basket
  - this is optional and not required for the core daily workflow
- `./scripts/experimental_maintenance_flow.sh`
  - run occasionally, usually overnight or before market open, when you want to settle old paper ideas and refresh calibration research
  - not required every time you use the daytime flow

Simple routine:

```bash
# After market close or overnight
./scripts/nighttime_flow.sh

# During the next trading day
./scripts/daytime_flow.sh
```

## Daily Workflow

Typical daytime loop:

```bash
cd /Users/hd/Developer/cortana-external/backtester
./scripts/daytime_flow.sh
```

What it does:
- refreshes market context by default
- prints the current market regime
- shows the latest leader buckets if available
- shows leader buckets as `% move (appearances)`:
  - `% move` = move over that bucket window
  - `(x)` = how many times that name has appeared in that bucket
- runs CANSLIM alert
- runs Dip Buyer alert
- runs a quick-check
- saves raw and formatted local artifacts under:
  - [var/local-workflows](./var/local-workflows)

Service note:
- the live engine expects the TS service at `http://localhost:3033` unless you override `MARKET_DATA_SERVICE_BASE_URL`
- if the service is unavailable, Python falls back to local cache where possible and otherwise uses conservative degraded behavior

Best use:
- during market hours
- when you want a compact local operator view

## Nightly Workflow

Typical nightly loop:

```bash
cd /Users/hd/Developer/cortana-external/backtester
./scripts/nighttime_flow.sh
```

What it does:
- runs broader nightly discovery
- refreshes the live-universe prefilter cache unless skipped
- refreshes liquidity overlay cache
- persists a fresh experimental-alpha snapshot
- refreshes the buy-decision calibration artifact
- rebuilds leader-basket artifacts

Service note:
- nightly discovery also depends on the TS market-data service for history, fundamentals, risk data, and base-universe refresh

Best use:
- after market close or overnight
- before the next day’s live scan

## Core Surfaces

## Market Data Boundary

The Python layer is now the engine only. External IO lives behind the TS service in:
- `/Users/hd/Developer/cortana-external/apps/external-service`

Provider order:
- `Schwab`
- `Yahoo` fallback inside TS
- Python local cache as the last fallback

Backtester-facing service endpoints:
- `GET /market-data/history/:symbol`
- `GET /market-data/quote/:symbol`
- `GET /market-data/snapshot/:symbol`
- `GET /market-data/fundamentals/:symbol`
- `GET /market-data/metadata/:symbol`
- `GET /market-data/news/:symbol`
- `GET /market-data/universe/base`
- `POST /market-data/universe/refresh`
- `GET /market-data/risk/history`
- `GET /market-data/risk/snapshot`

Optional compare mode:
- use `compare_with=alpaca` or another provider on the TS endpoints when you want a diagnostic comparison without changing the default runtime chain

Use these depending on what question you are asking:

- `uv run python advisor.py --market`
  - What is the market environment right now?

- `uv run python advisor.py --symbol NVDA`
  - Give me the full explanation for one stock.

- `uv run python advisor.py --quick-check BTC`
  - Is this single stock / proxy / coin worth attention right now?

- `uv run python canslim_alert.py --limit 8 --min-score 6`
  - Give me the compact CANSLIM-style summary.

- `uv run python dipbuyer_alert.py --limit 8 --min-score 6`
  - Give me the compact Dip Buyer summary.

- `uv run python nightly_discovery.py --limit 20`
  - Show me broader overnight leaders and refresh tomorrow’s inputs.

- `uv run python main.py --symbol NVDA --years 2 --compare`
  - Run the legacy backtest entrypoint.

- `./scripts/backtest_flow.sh`
  - Run the beginner-friendly historical backtest wrapper.

## Historical Backtesting

Use this when you want to test a strategy on past data instead of reading the live advisor flows.

Wrapper:

```bash
cd /Users/hd/Developer/cortana-external/backtester
./scripts/backtest_flow.sh
```

Examples:

```bash
# Backtest one symbol with the default momentum strategy
SYMBOL=NVDA YEARS=2 ./scripts/backtest_flow.sh

# Try a different built-in strategy
SYMBOL=MSFT YEARS=5 STRATEGY=aggressive ./scripts/backtest_flow.sh

# Compare all momentum variants instead of picking one strategy
SYMBOL=AAPL YEARS=3 COMPARE=1 ./scripts/backtest_flow.sh
```

Available env vars:
- `SYMBOL`
- `YEARS`
- `STRATEGY`
  - `momentum`
  - `aggressive`
  - `conservative`
- `CASH`
- `BENCHMARK`
- `COMPARE`

Important distinction:
- `backtest_flow.sh` = historical backtest on past price data
- `daytime_flow.sh` = live/operator analysis workflow
- `nighttime_flow.sh` = broader overnight discovery / cache refresh workflow

## Universe and Selection

Universe tiers:
- `quick`
  - growth watchlist only
- `standard`
  - curated broad universe plus dynamic additions
- `nightly_discovery`
  - broader nightly universe using live S&P 500 constituents when available

Live 120-name basket:
- explicit priority symbols are still pinned first
- nightly leader buckets now contribute bounded soft-priority
- static growth watchlist priority is bounded instead of dominating the basket
- remaining slots are filled by the deterministic prefilter ranking model
- if prefilter artifacts are stale or missing, the system falls back to deterministic ordering

Leader-bucket artifacts:
- latest snapshot:
  - [.cache/leader_baskets/latest-snapshot.json](./.cache/leader_baskets/latest-snapshot.json)
- rolling history:
  - [.cache/leader_baskets/history](./.cache/leader_baskets/history)
- latest buckets:
  - [.cache/leader_baskets/leader-baskets-latest.json](./.cache/leader_baskets/leader-baskets-latest.json)
- operator-friendly symbol files:
  - `daily.txt`
  - `weekly.txt`
  - `monthly.txt`
  - `priority.txt`

Leader-bucket display meaning:
- `OXY +3.2% (1x)`
  - `+3.2%` = move over that bucket window
  - `(1x)` = that symbol appeared once in that bucket window
- `daily.txt`, `weekly.txt`, and `monthly.txt` use the same `% move (appearances)` format
- `priority.txt` stays symbol-only because it is the bounded live-priority set, not a performance summary

Important boundary:
- leader buckets are operational watchlist-selection input
- they are not direct trade authority
- final `BUY / WATCH / NO_BUY` authority still comes from the Python regime + technical engine

## Polymarket Integration

Run before daytime stock alerts when you want fresh macro context:

```bash
cd /Users/hd/Developer/cortana-external
./tools/market-intel/run_market_intel.sh
```

What it does:
1. refreshes the `SPY` regime snapshot
2. rebuilds Polymarket artifacts
3. verifies the Python bridge can read them

Files written:
- [../var/market-intel/polymarket/latest-compact.txt](../var/market-intel/polymarket/latest-compact.txt)
- [../var/market-intel/polymarket/latest-report.json](../var/market-intel/polymarket/latest-report.json)
- [data/polymarket_watchlist.json](./data/polymarket_watchlist.json)

Runtime behavior:
- Polymarket is extra context, not the main decision authority
- stale Polymarket artifacts are rejected by freshness checks
- direct crypto remains contextual and does not automatically enter the stock screener

## Research and Calibration

Paper-only research commands:

```bash
cd /Users/hd/Developer/cortana-external/backtester

uv run python experimental_alpha.py --symbols NVDA,BTC,COIN
uv run python experimental_alpha.py --persist
uv run python experimental_alpha.py --settle
uv run python buy_decision_calibration.py
```

What these are for:
- `experimental_alpha.py`
  - paper-only research ideas
- `--persist`
  - save today’s research snapshot
- `--settle`
  - measure what happened later
- `buy_decision_calibration.py`
  - summarize whether recent research buckets have been useful

Important boundary:
- research artifacts can inform future tuning
- they do not directly own the live watchlist or live trade authority

## Artifacts and Cache

Important operational files:

- market regime snapshot:
  - [.cache/market_regime_snapshot_SPY.json](./.cache/market_regime_snapshot_SPY.json)
- live prefilter cache:
  - [data/cache/live_universe_prefilter.json](./data/cache/live_universe_prefilter.json)
- liquidity overlay cache:
  - [data/cache/liquidity_overlay.json](./data/cache/liquidity_overlay.json)
- buy-decision calibration:
  - [.cache/experimental_alpha/calibration/buy-decision-calibration-latest.json](./.cache/experimental_alpha/calibration/buy-decision-calibration-latest.json)

How to think about `.cache`:
- code = the brain
- `.cache` = working memory / prepared inputs
- `var/` = historical diary of actual runs

If `.cache` is missing:
- the repo is not ruined
- many artifacts can be rebuilt by rerunning the normal commands
- but the live system may become slower, less informed, or forced into fallback behavior until refreshed

## Troubleshooting

- Polymarket looks stale
  - rerun `./tools/market-intel/run_market_intel.sh`

- leader buckets are missing
  - run `./scripts/nighttime_flow.sh`

- local daytime flow says leader basket artifact is missing
  - run a nightly flow first so the bucket files exist

- prefilter cache is stale or missing
  - run `uv run python nightly_discovery.py --limit 20`
  - or `./scripts/nighttime_flow.sh`

- calibration says `no_settled_records`
  - the pipeline is usually fine
  - it means the research history exists but there are no settled samples yet

- Yahoo warnings or stale symbol noise during nightly runs
  - use the current `main`; the nightly path now suppresses common provider noise and removes obvious stale bundled symbols

## Development

```bash
cd /Users/hd/Developer/cortana-external/backtester

# Setup or refresh env
uv venv .venv
source .venv/bin/activate
uv pip sync requirements.txt

# Example targeted test run
uv run pytest tests/test_nightly_discovery.py tests/test_universe_selection.py
```
