# Backtester — CANSLIM Trading Advisor

A Python-based backtesting engine and trading advisor for:
- **CANSLIM-style growth breakout analysis**
- **Buy-the-Dip scanning**
- **market-regime-aware decision support**
- **incremental wave-based scoring upgrades**

This repo now includes a practical multi-wave market-intelligence stack layered on top of the original backtester.

## Fresh Clone Setup

If you just cloned the repo and want to run the backtester yourself, do this first:

```bash
# Install uv once if needed
curl -LsSf https://astral.sh/uv/install.sh | sh

cd /Users/hd/Developer/cortana-external/backtester
uv python install
uv venv .venv
source .venv/bin/activate
uv pip sync requirements.txt
```

Then start with these commands:

```bash
# 1. Check the overall market state
uv run python advisor.py --market

# 2. Analyze one stock
uv run python advisor.py --symbol NVDA

# 3. Quick verdict for a stock, proxy, or coin
uv run python advisor.py --quick-check BTC

# 4. Run the legacy backtest entrypoint
uv run python main.py --symbol NVDA --years 2 --compare
```

If you also want the Polymarket context layer:

```bash
cd /Users/hd/Developer/cortana-external
pnpm install
./tools/market-intel/run_market_intel.sh
```

Then come back to the Python side:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python canslim_alert.py --limit 8 --min-score 6
uv run python dipbuyer_alert.py --limit 8 --min-score 6
```

Important notes:
- you do not need Alpaca keys for normal backtester runs anymore
- `main.py` can run on Yahoo or cached data
- Polymarket integration is read-only
- if you skip the Polymarket step, the Python backtester still runs

## Start Here

If you are new, the easiest mental model is:

1. the Python backtester is the main decision engine
2. the TypeScript Polymarket layer is extra context
3. the market regime decides how aggressive you are allowed to be
4. the alerts and quick-check commands are the main things you read

Put differently:
- the Python side decides whether a stock setup is good or bad
- the Polymarket side adds macro/event context around that setup
- nothing in the Polymarket path directly places trades

## Read More

If you want more detail while reading this README, these are the best follow-up docs:
- [System flow diagram](/Users/hd/Developer/cortana-external/backtester/docs/polymarket-backtester-flow.md)
- [Wave buildout overview](/Users/hd/Developer/cortana-external/backtester/docs/docs-wave-overview.md)
- [Decision review loop](/Users/hd/Developer/cortana-external/backtester/docs/decision-review-loop.md)
- [Scoring and calibration notes](/Users/hd/Developer/cortana-external/backtester/docs/scoring-calibration.md)
- [Uncertainty/confidence PRD](/Users/hd/Developer/cortana-external/backtester/docs/uncertainty-confidence-prd.md)
- [Uncertainty runtime wiring](/Users/hd/Developer/cortana-external/backtester/docs/uncertainty-confidence-runtime-wiring.md)

## How Everything Connects

Think of the system as four layers:

1. Market context layer
- `./tools/market-intel/run_market_intel.sh`
- recalculates the current market state from `SPY` and saves that result to a cache file
- fetches Polymarket macro/event data
- writes fresh artifact files the Python side can read

2. Decision layer
- `advisor.py`
- scores stocks and dip setups
- checks the market regime first
- combines technicals, fundamentals, Wave 2/3 scoring, and Polymarket context

3. Operator layer
- `canslim_alert.py`
- `dipbuyer_alert.py`
- `advisor.py --quick-check`
- these are the commands you actually read during the day

4. Research layer
- `nightly_discovery.py`
- `experimental_alpha.py`
- these help discover more names and test ideas, but they do not own trade authority

## What Runs Automatically vs Manually

Usually this is the split:

Automatic / cron-friendly:
- `./tools/market-intel/run_market_intel.sh`
- `uv run python canslim_alert.py --limit 8 --min-score 6`
- `uv run python dipbuyer_alert.py --limit 8 --min-score 6`
- `uv run python nightly_discovery.py --limit 20`

Manual / operator-driven:
- `uv run python advisor.py --market`
- `uv run python advisor.py --symbol NVDA`
- `uv run python advisor.py --quick-check BTC`
- `uv run python main.py --symbol NVDA --years 2 --compare`
- `uv run python experimental_alpha.py --symbols NVDA,BTC,COIN`
- `uv run python buy_decision_calibration.py`

## What Each Command Is For

Use these questions:

- "What is the market environment right now?"
  Run `uv run python advisor.py --market`

- "Is this single stock or coin worth looking at?"
  Run `uv run python advisor.py --quick-check NVDA`
  Run `uv run python advisor.py --quick-check BTC`

- "Give me the fuller explanation for one stock."
  Run `uv run python advisor.py --symbol NVDA`

- "Give me the compact daily stock summary."
  Run `uv run python canslim_alert.py --limit 8 --min-score 6`

- "Give me the compact dip-buying summary."
  Run `uv run python dipbuyer_alert.py --limit 8 --min-score 6`

- "Show me what the old-style backtest says over 2 years."
  Run `uv run python main.py --symbol NVDA --years 2 --compare`

- "Show me more names overnight without slowing the daytime loop."
  Run `uv run python nightly_discovery.py --limit 20 --skip-live-prefilter-refresh`

- "Test research math in paper-only mode."
  Run `uv run python experimental_alpha.py --symbols NVDA,BTC,COIN`

- "Show me how reliable the recent research buckets have been."
  Run `uv run python buy_decision_calibration.py --json`

## Quick Start

```bash
cd ~/Developer/cortana-external/backtester

# Check market status
uv run python advisor.py --market

# Analyze a specific stock
uv run python advisor.py --symbol NVDA

# Fast stock / coin / proxy verdict
uv run python advisor.py --quick-check BTC

# Experimental paper-only alpha report
uv run python experimental_alpha.py --symbols NVDA,BTC,COIN

# Broader nightly discovery scan without refreshing the live prefilter cache
uv run python nightly_discovery.py --limit 20 --skip-live-prefilter-refresh

# Advisory calibration artifact from settled research outcomes
uv run python buy_decision_calibration.py

# Quick scan for opportunities (watchlist)
uv run python advisor.py --quick

# Telegram-ready CANSLIM alert summary
uv run python canslim_alert.py --limit 8 --min-score 6

# Run a backtest
uv run python main.py --symbol AAPL --years 2 --compare
```

Backtest data path:
- `main.py` now uses the same resilient `MarketDataProvider` layer as `advisor.py`
- it can run against Yahoo or cached data without requiring Alpaca credentials
- Alpaca remains useful as an optional live-data source, but it is no longer a hard requirement for routine backtests

Universe tiers:
- `quick`: growth watchlist only, used for fast operator loops
- `standard`: curated broad universe plus dynamic additions, used by the live daytime stack
- `nightly_discovery`: broader nightly sweep using live S&P 500 constituents when available, then layering growth and dynamic additions on top

Live 120-name scan selection:
- explicit priority symbols still get pinned first
- the remaining live scan slots are now filled by a cheap deterministic prefilter
- that prefilter ranks names by lightweight quality factors such as relative strength, trend quality, liquidity, distance from highs, pullback shape, and volatility sanity
- this means the daytime stack is now much closer to "best 120 by cheap quality model" instead of "first 120 by ordering"
- live alerts do not rebuild that prefilter inline; if the cache is missing or stale, they fall back to deterministic ordering and keep going
- bounded rank-modifier consumption is controlled by overlay promotion state:
  - only allowlisted overlays at `rank_modifier` stage can influence rank order
  - rank impact is tightly capped (default max `+/-5%` equivalent effect)
  - if promotion registry/state is missing or stale, selection falls back to the existing deterministic behavior instead of failing closed

## Buy-Decision Artifacts (Operator View)

Production-safe buy-decision inputs are file-backed and read-only in the daytime path:

- Feature snapshot (ranking input):
  - `/Users/hd/Developer/cortana-external/backtester/data/cache/live_universe_prefilter.json`
  - built by `RankedUniverseSelector.refresh_cache(...)`
  - consumed by CANSLIM/Dip Buyer live-universe selection
- Liquidity overlay snapshot (execution-quality context):
  - `/Users/hd/Developer/cortana-external/backtester/data/cache/liquidity_overlay.json`
  - refreshed with the same nightly prefilter refresh
  - used as a bounded rank modifier input when promotion policy allows it
- Optional calibration/promotion context (research layer only):
  - `/Users/hd/Developer/cortana-external/backtester/.cache/experimental_alpha/calibration/buy-decision-calibration-latest.json`
  - `/Users/hd/Developer/cortana-external/backtester/data/cache/overlay-attribution-latest.json`
  - `/Users/hd/Developer/cortana-external/backtester/data/cache/overlay-promotion-state.json`
  - produced by `uv run python buy_decision_calibration.py` and `uv run python experimental_alpha.py --overlay-attribution --evaluate-promotions`

Freshness and fallback:

- Daytime live alerts do not require inline cache rebuilds.
- If feature/liquidity snapshots are stale or missing, selection falls back to deterministic ordering and continues.
- Missing/stale research calibration artifacts do not break the base live path and do not change trade authority.
- Final BUY/WATCH/NO_BUY authority remains with the Python regime + technical engine.

Short workflow:

1. Nightly/pre-market refresh feature/liquidity snapshots:
```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python nightly_discovery.py --limit 20
```
If you only want the report and do not want to refresh the live prefilter cache in that run:
```bash
uv run python nightly_discovery.py --limit 20 --skip-live-prefilter-refresh
```
2. Daytime live scans consume snapshots (or deterministic fallback if stale/missing):
```bash
uv run python canslim_alert.py --limit 8 --min-score 6
uv run python dipbuyer_alert.py --limit 8 --min-score 6
```
3. Optional research calibration/promotion context refresh:
```bash
uv run python buy_decision_calibration.py
uv run python experimental_alpha.py --settle --overlay-attribution --evaluate-promotions
```

## Daily Flow

This is the simplest practical workflow:

1. refresh context
```bash
cd /Users/hd/Developer/cortana-external
./tools/market-intel/run_market_intel.sh
```

What "refresh context" means:
- update the `SPY` market-regime snapshot
- fetch the latest Polymarket context
- write fresh files that the Python alert layer reads

What "SPY market-regime snapshot" means:
- `SPY` is the S&P 500 ETF
- the system uses `SPY` as the main proxy for "what is the overall stock market doing right now?"
- it calculates whether the market is in a state like:
  - `confirmed_uptrend`
  - `uptrend_under_pressure`
  - `correction`
- it saves that result so later commands do not have to guess the market state again

Simple example:
- if `SPY` looks weak and the regime snapshot says `correction`, the system becomes defensive
- if `SPY` looks healthy and the regime snapshot says `confirmed_uptrend`, the system is allowed to be more constructive

2. check the market regime
```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python advisor.py --market
```

3. read the compact daytime summaries
```bash
uv run python canslim_alert.py --limit 8 --min-score 6
uv run python dipbuyer_alert.py --limit 8 --min-score 6
```

4. deep-dive one name if needed
```bash
uv run python advisor.py --symbol NVDA
uv run python advisor.py --quick-check BTC
```

What this means in plain English:
- if the market regime is bad, the system should get defensive
- if a stock looks good technically, Polymarket can support or conflict with that idea
- if Polymarket conflicts, you should become more cautious, not blindly short or buy
- if Polymarket supports and the technicals are also good, the setup becomes more interesting

## Night Flow

Nightly discovery is separate on purpose.

During the day:
- keep the scan smaller and faster
- focus on names already most worth your attention

At night:
- run a broader discovery pass
- let new names surface from a wider universe
- refresh the cached live-universe prefilter used by the daytime 120-name scan
- review them the next morning

Typical nightly command:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python nightly_discovery.py --limit 20
```

What it does:
- scans a broader universe than the daytime alerts
- tries to use fresh S&P 500 constituents
- merges in growth names and dynamic names
- refreshes the cached live prefilter and liquidity overlay artifacts used by the daytime alerts unless you explicitly skip it
- surfaces any existing buy-decision calibration artifact so you can see whether research context is fresh or stale
- returns a ranked list of leaders for review

What it does not do:
- it does not buy anything
- it does not replace the daytime alert path
- it does not override the main regime/technical engine

## Polymarket Context Integration

The Python alert pipeline now consumes a read-only Polymarket intelligence layer from the TypeScript workspace package at [`packages/market-intel`](/Users/hd/Developer/cortana-external/packages/market-intel).

Quick diagram:
- [`docs/polymarket-backtester-flow.md`](/Users/hd/Developer/cortana-external/backtester/docs/polymarket-backtester-flow.md)

Run the bridge before CANSLIM or Dip Buyer alerts:

```bash
cd /Users/hd/Developer/cortana-external
./tools/market-intel/run_market_intel.sh
```

Production order is explicit:
1. recalculate the overall stock-market state from `SPY` and save it as a fresh regime snapshot
2. run the TypeScript Polymarket integration against that snapshot
3. verify Python can read the resulting artifacts
4. run CANSLIM / Dip Buyer alerts

The wrapper above already executes steps 1-3 in that order.

This writes:
- `/Users/hd/Developer/cortana-external/var/market-intel/polymarket/latest-compact.txt`
- `/Users/hd/Developer/cortana-external/var/market-intel/polymarket/latest-report.json`
- `/Users/hd/Developer/cortana-external/backtester/data/polymarket_watchlist.json`

Runtime effects:
- `canslim_alert.py` and `dipbuyer_alert.py` prepend the compact Polymarket macro/context summary and now also render structured posture/focus lines when the JSON artifact is fresh.
- `UniverseScreener.get_dynamic_tickers()` merges the Polymarket-derived watchlist with the existing dynamic watchlist, but only for stock / ETF / crypto-proxy names. Direct crypto symbols remain contextual and do not enter the stock screener.
- The integration is read-only and does not place trades or interact with wallets/accounts.
- The wrapper now fails fast if artifacts are stale or required registry themes lose coverage.
- overlay should be populated whenever a fresh regime snapshot is available; the health path treats missing overlay in that situation as a failure.

Plain-English meaning:
- Polymarket is not the boss
- it is extra context that can make you more confident or more cautious
- the Python stock engine still decides whether a setup is actually buyable
- direct crypto can inform context, but it does not automatically enter the stock screener

Simple example:
- `NVDA` can look technically strong
- Polymarket might say macro context is `supportive`, which makes the setup more interesting
- or Polymarket might say macro context is `conflicting`, which means you should be more careful
- but the Python stock engine still makes the final `BUY / WATCH / NO_BUY` call

## Operator workflow

Use the surfaces in this order when you are reviewing the stack end to end:
- `./tools/market-intel/run_market_intel.sh` refreshes the Python regime snapshot first, then rebuilds and verifies the external Polymarket context consumed by the Python alerts.
- `uv run python advisor.py --market` checks the regime gate and sizing posture before you read any single-name output.
- `uv run python advisor.py --symbol NVDA` is the fastest single-name diagnostic when you want factor detail plus the current recommendation.
- `uv run python advisor.py --quick-check BTC` is the fast verdict path for a stock, crypto proxy, or direct crypto alias when you want one bounded answer without reading the full alert.
- `uv run python quick_check_batch.py --symbols AAPL,MSFT,COIN` is the bounded batch surface for cron/operator re-checks of the current `BUY/WATCH` basket.
- `uv run python canslim_alert.py --limit 8 --min-score 6` and `uv run python dipbuyer_alert.py --limit 8 --min-score 6` generate the compact operator summaries used for daily review.
- `TradingAdvisor().compare_model_families(...)["report"]` is the review surface for Wave 4 model-family deltas, restraint metrics, and review slices.

When Polymarket context is available, the alert surface now gives you:
- `Polymarket posture`: bounded `supportive | neutral | conflicting` context plus a lightweight aggression dial
- `Polymarket focus`: overlap names already on the technical watchlist, early-runway names, and crypto/crypto-proxy names worth checking next
- direct crypto remains context-only here; it does not override the stock regime/technical engine and it does not auto-enter the stock universe

The quick-check command follows the same guardrails:
- stocks and crypto proxies use the base stock-analysis path
- direct crypto aliases like `BTC`, `ETH`, and `SOL` map to `BTC-USD`, `ETH-USD`, and `SOL-USD` and use the existing dip/recovery path
- Polymarket can downgrade or annotate the verdict, but it does not create a trade by itself

`quick_check_batch.py` uses the same underlying `TradingAdvisor.quick_check()` path and exists so the production re-check lane can evaluate a small basket without rerunning the full daytime scanner.

## Nightly discovery

There is now a separate broader discovery surface at [`nightly_discovery.py`](/Users/hd/Developer/cortana-external/backtester/nightly_discovery.py).

Use it when you want wider overnight coverage without slowing the daytime alert loop:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python nightly_discovery.py --limit 20 --skip-live-prefilter-refresh
uv run python nightly_discovery.py --limit 30 --refresh-sp500 --json
uv run python nightly_discovery.py --limit 20
```

What it does:
- uses the `nightly_discovery` universe profile
- pulls live S&P 500 constituents from a public source when available and caches them locally
- falls back to the repo’s static constituent list if live refresh is unavailable
- layers in the growth watchlist and fresh dynamic names
- ranks the surfaced leaders through the existing Python analysis path

Current source note:
- the live constituent refresh currently comes from a public Wikipedia S&P 500 table
- that is acceptable for a fallback-tolerant overnight discovery job, but it is still an HTML scrape
- if the live refresh fails, the code now logs a warning and falls back to cache, then to the bundled static list

What it does not do:
- it does not replace the daytime alert path
- it does not override the Python regime/technical engine
- it does not place trades

Recommended use:
- keep the live alert path on the current `standard` universe
- use `uv run python nightly_discovery.py --limit 20 --skip-live-prefilter-refresh` for a bounded operator report
- schedule `uv run python nightly_discovery.py --limit 20` after market close or overnight when you also want to refresh the live prefilter cache
- let that nightly job refresh the live prefilter cache for the next session
- review the nightly leaders the next morning and let only the best names graduate into the normal operator workflow

## Experimental alpha research

There is now a separate paper-only research surface at [`experimental_alpha.py`](/Users/hd/Developer/cortana-external/backtester/experimental_alpha.py).

Use it for equation/algorithm experiments only:
- it reuses `quick_check` plus fresh Polymarket structured context
- it computes a paper-only calibrated probability, edge, capped Kelly fraction, and expected move estimate
- it logs contextual overlay dimensions for each paper candidate:
  - risk budget state
  - aggression posture
  - execution quality + liquidity tier
  - optional spread/slippage/ADV notes when available
- it outputs `paper_long`, `track`, `reduce_or_wait`, or `skip`
- it does not place orders
- it is not wired into cron or the production alert path

Run it manually:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python experimental_alpha.py --symbols NVDA,BTC,COIN
uv run python experimental_alpha.py --json
uv run python experimental_alpha.py --persist
uv run python experimental_alpha.py --settle
uv run python experimental_alpha.py --calibrate --minimum-samples 20
```

Guardrails:
- treat the formulas as research heuristics, not truth
- keep it paper-only until forward-tested
- do not route this into the production buy/no-buy path without separate validation

Execution-readiness research workflow:
1. `uv run python experimental_alpha.py --persist`
   This snapshots the current paper candidates under `.cache/experimental_alpha/snapshots/`.
2. `uv run python experimental_alpha.py --settle`
   This settles prior snapshots against later market data and writes forward returns under `.cache/experimental_alpha/settled/`.
3. `uv run python experimental_alpha.py --calibrate --minimum-samples 20`
   This builds the calibration and promotion-gate report from the settled sample set.
   It now also reports 5d overlay slices for repeated buckets (`n>=2`) so you can review
   whether specific risk-budget or execution-quality states are helping or hurting.

Promotion gate intent:
- `ready` means the current `paper_long` bucket cleared the present research thresholds for sample count, 5d hit rate, average 5d return, and Brier score.
- `blocked` means the sample is still too small or too weak to justify promoting any part of the heuristic into the live production decision path.
- overlay slice metrics are informational only in this phase; they do not change live buy/no-buy authority.

Settlement semantics:
- snapshot entry uses the first trading bar at or after the snapshot timestamp
- `1d`, `5d`, and `10d` mean trading-bar offsets, not calendar days
- partially matured snapshots are intentionally included
- if a horizon is not mature yet, that horizon stays empty instead of being fabricated

When experimental alpha can be promoted:
- It stays paper-only by default. No production promotion happens just because the report looks good for a few days.
- The first eligible promotion target is a bounded annotation layer, not direct trade authority. In practice that means watchlist priority, quick-check commentary, or a small conviction modifier inside the existing Python regime/technical engine.
- Promotion is only allowed when all of the following are true:
  1. `uv run python experimental_alpha.py --calibrate --minimum-samples 20` returns `Promotion gate: ready`
  2. the settled sample includes at least `20` `paper_long` candidates
  3. `paper_long` 5d hit rate is at least `55%`
  4. `paper_long` average 5d return is at least `+1.0%`
  5. `paper_long` 5d Brier score is at most `0.23`
  6. the broader backtester test suite still passes after the integration change
  7. the promoted logic remains bounded so Polymarket stays contextual and does not replace the Python regime/technical engine
- Even after the gate clears, promotion should happen in stages:
  1. research report only
  2. watchlist / quick-check annotation
  3. small bounded decision modifier
  4. anything larger only after another forward-test cycle
- This research path should not become a permanent live input if:
  - the gate falls back to `blocked`
  - calibration degrades after rollout
  - results are concentrated in one short regime pocket instead of holding across multiple conditions
  - the logic starts overriding base regime/technical discipline instead of supplementing it

Example report command:

```bash
uv run python - <<'PY'
from advisor import TradingAdvisor

report = TradingAdvisor().compare_model_families(quick=True, min_score=6, top_n=5)["report"]
print(report)
PY
```

## How to read runtime output

- `tq`: trade-quality score after setup, confidence, downside/churn, and adverse-regime penalties are combined.
- `conf` / `eff conf`: effective confidence after uncertainty and market-stress adjustments.
- `u`: uncertainty percent. Higher means the setup is being discounted more heavily.
- `down/churn`: bounded downside and churn penalty layers. Lower is cleaner.
- `stress`: adverse-regime label plus score. Anything above `normal` means the market backdrop is leaning against the setup.
- `Decision review`: compact current-run audit block for the top recent `BUY`/`WATCH`/`NO_BUY` decisions in the live alert.
- `Tuning balance`: shows clean buys, risky-buy proxy, abstains, vetoes, and a higher-trade-quality restraint proxy so operators can tune centralized scoring defaults without changing selection logic.
- `restraint`: how often a model kept capital out of `BUY`; use it with restrained-return splits to judge whether caution helped.
- `Review slices`: compact regime/time spot checks to see whether performance differences are broad or concentrated in one market pocket.

## What was added in the recent buildout

The recent wave-based buildout added:
- **Wave 1:** better outcome labeling, richer market regime context, dip recovery / falling-knife filter
- **Wave 2:** breakout follow-through scoring, sentiment overlay, exit risk scoring
- **Wave 3:** confidence/regime-aware sizing, sector-relative strength context, catalyst/event weighting
- **Wave 4:** model/scoring comparison harness to evaluate whether simpler approaches are already enough

See:
- `docs-wave-overview.md`

## Project Structure

```
backtester/
├── advisor.py           # Main trading advisor (recommendations + wave scoring integration)
├── canslim_alert.py     # Daily CANSLIM alert formatter (Telegram-ready)
├── dipbuyer_alert.py    # Dip Buyer alert formatter
├── main.py              # Backtest runner
├── backtest.py          # Core backtesting engine
├── metrics.py           # Performance calculations (Sharpe, Sortino, etc.)
├── indicators.py        # Technical indicators (SMA, RSI, MACD, etc.)
├── outcomes.py          # Outcome labeling utilities (Wave 1)
├── requirements.txt     # Python dependencies
├── docs-wave-overview.md # Plain-English map of the Wave 1-4 buildout
│
├── data/
│   ├── fetcher.py       # Alpaca price data
│   ├── fundamentals.py  # Yahoo Finance fundamentals + context support
│   ├── universe.py      # Stock screening/filtering
│   ├── market_regime.py # Market regime logic / scorecards
│   ├── wave2.py         # Breakout, sentiment, and exit-risk scoring (Wave 2)
│   ├── wave3.py         # Sizing, sector, and catalyst scoring (Wave 3)
│   └── cache/           # Cached data
│
├── evaluation/
│   └── comparison.py    # Model/scoring comparison harness (Wave 4)
│
└── strategies/
    ├── base.py          # Abstract Strategy class
    ├── momentum.py      # Momentum strategies
    ├── canslim.py       # CANSLIM implementation
    └── dip_buyer.py     # Dip Buyer strategy logic
```

## CANSLIM Factors

| Factor | Name | Source | Implementation |
|--------|------|--------|----------------|
| C | Current Earnings | yfinance | `fundamentals.py` |
| A | Annual Earnings | yfinance | `fundamentals.py` |
| N | New High | Price data | `canslim.py` |
| S | Supply/Demand | Float + Volume | `fundamentals.py` + `canslim.py` |
| L | Leader | Price momentum | `canslim.py` |
| I | Institutional | yfinance | `fundamentals.py` |
| M | Market Direction | SPY analysis | `market_regime.py` |

## Scoring

- Each factor: 0-2 points
- Total: 0-12 points
- Buy threshold: >= 7 points (configurable)
- M factor acts as a GATE (no buys in correction)

## Market Regimes

| Regime | Position Sizing | Action |
|--------|-----------------|--------|
| Confirmed Uptrend | 100% | Full buying |
| Uptrend Under Pressure | 50% | Reduced exposure |
| Rally Attempt | 50% | Cautious buying |
| Correction | 0% | No new buys |

Regime handling is now part of a broader scoring stack rather than only a blunt gate.
It feeds:
- dip recovery / falling-knife filtering
- breakout follow-through confidence
- confidence/regime-based sizing
- comparison/evaluation runs

## Example Output

```
📊 Analyzing NVDA
   Price: $182.81
   Total Score: 5/12

   Fundamental: C=2 A=2 I=1 S=0
   Technical:   N=0 L=0 S=0

   Recommendation: NO_BUY
   Reason: Score too low (5/12). Need >= 7.
```

## Strategies and scoring layers

### MomentumStrategy
- Uses MA crossovers + RSI
- 8% trailing stop
- Three variants: Standard, Aggressive, Conservative

### CANSLIMStrategy
- Full CANSLIM with fundamentals
- Requires `set_symbol()` before running
- Uses market regime gate and now benefits from downstream wave scoring in advisor flow

### CANSLIMLite
- Technical factors only (N, L, S, M)
- No fundamental data needed
- Faster backtesting

### Dip Buyer
- Separate dip-quality / recovery logic
- now uses richer Wave 1 context to distinguish:
  - healthy pullback
  - oversold bounce candidate
  - falling knife / structural damage risk

### Wave 2 overlays
- breakout follow-through score
- sentiment overlay
- exit risk score

### Wave 3 overlays
- confidence/regime-aware sizing
- sector-relative strength context
- catalyst/event weighting
- adverse-regime ensemble that combines regime posture, distribution/drawdown stress, and existing macro stress inputs into one bounded warning layer

### Wave 4 evaluation layer
- compare baseline vs enhanced scoring/model families
- comparison summaries now surface trade quality, effective confidence, uncertainty, downside/churn proxies, restraint counts, restrained-return splits, and adverse-regime stress where those fields exist
- rendered reports keep `BUY`/`WATCH`/`NO_BUY` and abstain states visible, call out avoided baseline bad outcomes plus veto-preserved bad-outcome proxies when current data can measure them, and add bounded review slices for regime splits plus early/late time splits when those columns exist
- tune the bounded weights/bands for trade quality, downside/churn, adverse-regime stress, and Wave 4 comparison ranking in [`docs/scoring-calibration.md`](docs/scoring-calibration.md)
- use this before adding more modeling complexity

## API Keys

Alpaca keys stored at: `~/Developer/cortana-external/backtester/alpaca_keys.json`

```json
{
  "key_id": "YOUR_KEY",
  "secret_key": "YOUR_SECRET",
  "base_url": "https://paper-api.alpaca.markets/v2",
  "data_url": "https://data.alpaca.markets"
}
```

## FRED HY Spread Reliability (Dip Buyer)

Dip Buyer reads HY spreads from FRED (`BAMLH0A0HYM2`).

Recommended env vars:

```bash
export FRED_API_KEY=your_key_here            # recommended (reduces unauthenticated limits)
export RISK_FRED_RETRIES=3                   # default: 3
export RISK_FRED_TIMEOUT_SECONDS=12          # default: 12
export RISK_FRED_BACKOFF_SECONDS=1.5         # default: 1.5
```

If FRED fails after retries, the system now reports fallback explicitly:
- HY source becomes `fallback_default_450`
- alert includes fallback impact note (`neutral-credit assumption`)
- credit gate behavior remains strict; this only prevents silent ambiguity.

## Dependencies

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv venv .venv
source .venv/bin/activate
uv pip sync requirements.txt
```

Key packages:
- `pandas` — Data manipulation
- `numpy` — Numerical operations
- `yfinance` — Yahoo Finance data
- `requests` — HTTP for Alpaca API

## Development

```bash
# One-time setup (or after requirements changes)
uv venv .venv
source .venv/bin/activate
uv pip sync requirements.txt

# Run tests
uv run python data/fundamentals.py
uv run python data/market_regime.py
uv run python strategies/canslim.py

# Full backtest
uv run python main.py --symbol AAPL --years 2 --strategy momentum
```

## Phase Status (per PRD)

- [x] Phase 1: Portfolio Intelligence (Alpaca read access)
- [x] Phase 2: Strategy Engine + Backtesting
  - [x] Backtesting framework
  - [x] Momentum strategies
  - [x] CANSLIM implementation
  - [x] Universe screening
  - [x] Market regime detection (M factor)
  - [x] Fundamental data (yfinance)
  - [ ] Genetic optimization (TODO)
- [ ] Phase 3: Trade Recommendations (in progress)
  - [x] Trade signal generation
  - [x] Position sizing based on regime
  - [x] Telegram alerts integration (via `canslim_alert.py` + OpenClaw cron)
  - [ ] Trade tracking (/executed, /declined)
- [ ] Phase 4: Automated Execution (future, optional)

---

*Built by Cortana for Hamel*


## Decision review

- Live scan alerts now include a compact **Decision review** block for recent BUY / WATCH / NO_BUY outcomes.
- Use it to inspect restraint, vetoes, and risky-vs-clean buys before tuning scoring defaults.
- See `docs/decision-review-loop.md` for how to read the review block.
