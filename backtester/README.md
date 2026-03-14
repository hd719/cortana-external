# Backtester — CANSLIM Trading Advisor

A Python-based backtesting engine and trading advisor for:
- **CANSLIM-style growth breakout analysis**
- **Buy-the-Dip scanning**
- **market-regime-aware decision support**
- **incremental wave-based scoring upgrades**

This repo now includes a practical multi-wave market-intelligence stack layered on top of the original backtester.

## Quick Start

```bash
cd ~/Developer/cortana-external/backtester
source venv/bin/activate

# Check market status
python advisor.py --market

# Analyze a specific stock
python advisor.py --symbol NVDA

# Fast stock / coin / proxy verdict
python advisor.py --quick-check BTC

# Quick scan for opportunities (watchlist)
python advisor.py --quick

# Telegram-ready CANSLIM alert summary
python canslim_alert.py --limit 8 --min-score 6

# Run a backtest
python main.py --symbol AAPL --years 2 --compare
```

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
1. refresh SPY regime snapshot with `backtester/data/market_regime.py`
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

## Operator workflow

Use the surfaces in this order when you are reviewing the stack end to end:
- `./tools/market-intel/run_market_intel.sh` refreshes the Python regime snapshot first, then rebuilds and verifies the external Polymarket context consumed by the Python alerts.
- `python advisor.py --market` checks the regime gate and sizing posture before you read any single-name output.
- `python advisor.py --symbol NVDA` is the fastest single-name diagnostic when you want factor detail plus the current recommendation.
- `python advisor.py --quick-check BTC` is the fast verdict path for a stock, crypto proxy, or direct crypto alias when you want one bounded answer without reading the full alert.
- `python canslim_alert.py --limit 8 --min-score 6` and `python dipbuyer_alert.py --limit 8 --min-score 6` generate the compact operator summaries used for daily review.
- `TradingAdvisor().compare_model_families(...)["report"]` is the review surface for Wave 4 model-family deltas, restraint metrics, and review slices.

When Polymarket context is available, the alert surface now gives you:
- `Polymarket posture`: bounded `supportive | neutral | conflicting` context plus a lightweight aggression dial
- `Polymarket focus`: overlap names already on the technical watchlist, early-runway names, and crypto/crypto-proxy names worth checking next
- direct crypto remains context-only here; it does not override the stock regime/technical engine and it does not auto-enter the stock universe

The quick-check command follows the same guardrails:
- stocks and crypto proxies use the base stock-analysis path
- direct crypto aliases like `BTC`, `ETH`, and `SOL` map to `BTC-USD`, `ETH-USD`, and `SOL-USD` and use the existing dip/recovery path
- Polymarket can downgrade or annotate the verdict, but it does not create a trade by itself

Example report command:

```bash
python - <<'PY'
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
pip install -r requirements.txt
```

Key packages:
- `pandas` — Data manipulation
- `numpy` — Numerical operations
- `yfinance` — Yahoo Finance data
- `requests` — HTTP for Alpaca API

## Development

```bash
# Activate venv
source venv/bin/activate

# Run tests
python data/fundamentals.py
python data/market_regime.py
python strategies/canslim.py

# Full backtest
python main.py --symbol AAPL --years 2 --strategy momentum
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
