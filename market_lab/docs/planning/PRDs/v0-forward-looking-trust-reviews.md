# Market Lab V0 Forward-Looking Trust Reviews PRD

**Document Status:** Draft  
**Owner:** Trading systems  
**Last Updated:** 2026-05-08  
**Depends On:** TradingAgents lab fork, Mission Control runtime, existing market-data service

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | Hamel |
| Epic | Market Lab V0 |

---

## Problem / Opportunity

The current backtester has become difficult to understand, debug, and trust. It mixes strategy scans, runtime artifacts, lifecycle state, calibration, Mission Control surfaces, and historical measurement under a name that no longer explains the product. That makes it hard to learn what the system is doing or decide whether a trading recommendation deserves confidence.

Market Lab is a new, isolated product surface with this mission:

> A system that lets you test, explain, compare, and trust trading decisions before they ever become real alerts or execution candidates.

V0 should not clone the old backtester. It should create a small, understandable loop: manually enter one symbol, run a forward-looking review, compare deterministic market checks against a TradingAgents second opinion, save one explainable artifact, show it in Mission Control, and passively measure later outcomes.

---

## Insights

1. Trust starts with explainability, not model complexity. Hamel should be able to inspect one symbol review and understand the facts, interpretation, verdict, and missing evidence without reading logs.
2. TradingAgents is valuable as an investment-committee style second opinion, but not as the system of record or an executor.
3. Outcome tracking should start early. Even in v0, Market Lab should record whether trusted, uncertain, and blocked reviews later beat or underperformed SPY.

Market Lab intentionally separates live forward-looking reviews from historical backtesting. Historical as-of-date runs are valuable later, but they are out of scope for v0.

---

## Development Overview

Build an isolated `market_lab` module inside `cortana-external` plus a new Mission Control view/API. A v0 user enters one symbol, starts a background review job, watches a step timeline, and opens the resulting review artifact.

The backend engine should be written in production-shaped Python that remains easy to read and debug. Market Lab should use typed functions, clear Pydantic contracts, explicit module boundaries, structured events/logs, pytest coverage, and small CLI debugging commands. It should avoid clever metaprogramming, deep inheritance, hidden globals, async-everywhere architecture, and god-object runners. The code should be advanced enough to be durable, but explainable enough that Hamel can learn and debug it.

The artifact is the source of truth. Mission Control and APIs read from saved artifacts and a SQLite run index instead of duplicating verdict logic in the UI. Raw artifacts and logs live on the filesystem under `.cache/market_lab/`; SQLite indexes runs for listing, search, status, verdict, and settlement state.

A v0 review uses live current data only. During market hours, core price data must be fresh within 5-10 minutes or the Trust Verdict is blocked. Outside market hours, Market Lab uses the latest available close or extended-hours price when available and labels the price basis clearly.

Each run compares:

- deterministic Cortana-style checks: price freshness, current price, prior close, day change, volume, recent candles, basic indicators, data completeness, optional evidence availability, and simple risk flags
- TradingAgents review: analyst/researcher/trader/risk/portfolio-manager opinion as a second-opinion research lane
- final Trust Verdict: `trusted`, `uncertain`, or `blocked`
- passive outcome tracking: 1D, 5D, and 20D raw P/L plus alpha vs SPY using market close prices

---

## Success Metrics

V0 product success:

- A user can run one symbol review from Mission Control with manual input.
- The review runs as a background job with visible queued/running/done/failed timeline steps.
- The review saves a valid artifact and persistent logs.
- Mission Control renders the artifact in a way Hamel can understand and debug.
- The UI separates facts from interpretation.
- Stale market-hours price data produces a blocked verdict with an explicit reason.

V0 measurement success:

- Every run records the reference entry price and SPY reference price.
- V0 tracks 1D, 5D, and 20D settlement windows.
- Raw P/L and alpha vs SPY are shown for every settled window.
- A trusted review is considered successful when alpha vs SPY is positive for the settlement window.
- A blocked or uncertain review is considered a good avoid when the symbol later underperforms SPY.

---

## Assumptions

- `cortana-external` remains the right home because Market Lab needs Mission Control and existing market-data access.
- `market_lab` stays isolated from old backtester internals in v0.
- The TradingAgents fork remains a lab dependency and second-opinion lane, not a production executor.
- Existing market-data infrastructure can provide live price data and SPY reference prices with enough freshness for v0.
- Filesystem artifacts plus a SQLite index are sufficient before introducing a heavier database.
- Settlement uses market close prices for consistency.
- Hamel wants to learn and debug the Python code, so implementation should favor explicit, well-typed, well-tested modules over framework magic.

---

## Out of Scope

V0 explicitly does not include:

- broker execution
- execution-shaped artifacts
- paper trading
- Telegram alerts
- automatic candidate import from old backtester/Cortana scans
- historical as-of-date backtesting
- multi-symbol batch reviews
- model bakeoffs across multiple LLM providers
- replacing or deleting the old backtester
- using TradingAgents as a direct source of trade actions

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Manual Symbol Review](#manual-symbol-review) | Start one forward-looking review for one symbol from Mission Control. | V0 input is manual only. |
| [Background Run Lifecycle](#background-run-lifecycle) | Run reviews as jobs with statuses, timeline events, logs, and artifact output. | Avoid synchronous request timeouts. |
| [Review Artifact Contract](#review-artifact-contract) | Save one explainable artifact per run as the source of truth. | UI/API must read this artifact. |
| [Trust Verdict](#trust-verdict) | Produce `trusted`, `uncertain`, or `blocked` with explicit reasons. | `trusted` means eligible for alert consideration later, not buy now. |
| [TradingAgents Second Opinion](#tradingagents-second-opinion) | Include TradingAgents review as research evidence. | It cannot override hard evidence blockers. |
| [Outcome Settlement](#outcome-settlement) | Track 1D, 5D, and 20D outcomes using raw P/L and alpha vs SPY. | Settlements use market close prices. |
| [Debuggable Python Architecture](#debuggable-python-architecture) | Build the Python core with clear modules, contracts, tests, logs, and CLI debugging tools. | Production-shaped, not toy Python. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Market Lab | New isolated forward-looking trading review product. |
| Review run | One symbol review requested at one timestamp. |
| Review artifact | Saved source-of-truth JSON/Markdown output for a run. |
| Trust Verdict | Final review outcome: `trusted`, `uncertain`, or `blocked`. |
| Trusted | Evidence is strong enough to be eligible for alert consideration later. It does not mean execute a trade. |
| Blocked | Hard evidence problem prevents trust, such as stale/missing core price data, failed TradingAgents review, or invalid artifact. |
| Uncertain | Review is valid but mixed, weak, partial, or missing optional evidence. |
| Alpha vs SPY | Symbol return minus SPY return over the same settlement window. |
| Good avoid | A blocked or uncertain review where the symbol later underperformed SPY. |

---

### Manual Symbol Review

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want to type a ticker symbol into Mission Control and run a Market Lab review so that I can inspect one trade idea without using the old backtester. | V0 supports one symbol per run. |
| Accepted | As Hamel, I want the review to use live current data so that the result reflects the current candidate, not a historical backtest. | Historical mode is later work. |
| Accepted | As Hamel, I want off-hours reviews to clearly label the latest available price basis so that I know whether I am looking at close or extended-hours data. | Latest available outside market hours is acceptable. |

### Background Run Lifecycle

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want reviews to run in the background so that TradingAgents latency does not freeze or timeout the UI. | Statuses should include queued, running, done, failed. |
| Accepted | As Hamel, I want a timeline showing major steps so that I know what the system is doing. | Example: queued, price data, deterministic checks, TradingAgents, verdict artifact, settlement scheduled. |
| Accepted | As Hamel, I want persisted logs for each run so that failures are debuggable from Mission Control or SSH. | Logs should be saved even if the final artifact fails. |

### Review Artifact Contract

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want every run to save one explainable artifact so that the UI and future LLMs can inspect the same truth. | Artifact remains source of truth. |
| Accepted | As Hamel, I want facts separated from interpretation so that I can tell whether a bad verdict came from bad data or bad reasoning. | Facts include prices, volume, indicators, evidence availability. Interpretation includes momentum, sentiment posture, risk flags, TradingAgents opinion, verdict. |
| Accepted | As Hamel, I want filesystem artifacts and a SQLite run index so that raw output is easy to inspect while run history remains searchable. | Example paths below. |

Suggested storage shape:

```text
.cache/market_lab/market_lab.sqlite
.cache/market_lab/runs/<run_id>/review.json
.cache/market_lab/runs/<run_id>/events.jsonl
.cache/market_lab/runs/<run_id>/tradingagents.md
.cache/market_lab/runs/<run_id>/logs.txt
```

### Trust Verdict

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want a Trust Verdict of `trusted`, `uncertain`, or `blocked` so that Market Lab uses trust language rather than execution commands. | Avoid BUY/WATCH/NO_TRADE in v0 product copy. |
| Accepted | As Hamel, I want `trusted` to mean eligible for alert consideration later, not buy now. | No execution implication. |
| Accepted | As Hamel, I want stale market-hours core price data to produce `blocked` so that Market Lab never trusts stale live evidence. | Freshness target is 5-10 minutes. |
| Accepted | As Hamel, I want optional missing news, fundamentals, or sentiment to be visible but not automatically blocking. | Missing optional evidence can lead to uncertain. |

### TradingAgents Second Opinion

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want TradingAgents to review the same symbol as an outside investment committee so that Market Lab can compare deterministic checks with agent reasoning. | Use as second-opinion research. |
| Accepted | As Hamel, I want TradingAgents failures to be explicit so that I know whether a review was blocked or only partial. | Required for non-blocked review in v0. |
| Accepted | As Hamel, I want TradingAgents output saved separately so that I can inspect the raw committee-style reasoning. | `tradingagents.md` or equivalent. |

### Outcome Settlement

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want every review to record entry/reference prices so that I can later see what would have happened without paper trading. | Passive measurement only. |
| Accepted | As Hamel, I want settlement windows of 1D, 5D, and 20D so that I can measure next-day, one-week, and roughly one-month outcomes. | Use market close prices. |
| Accepted | As Hamel, I want both raw P/L and alpha vs SPY so that I can see whether the idea made money and whether it beat the market. | Alpha vs SPY is headline quality metric. |
| Accepted | As Hamel, I want a manual settle-now action plus scheduled settlement so that normal measurement is automatic but still debuggable. | Each window settles once. |
| Accepted | As Hamel, I want newly settled windows to alert my OpenClaw monitor so that I can see whether the idea beat SPY without opening Mission Control. | Alert includes raw return, SPY return, alpha vs SPY, score, window, and run id. |

### Debuggable Python Architecture

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want the Python engine to use real production patterns so that the system is durable without hiding behavior behind magic. | Use typed functions, Pydantic models, pytest fixtures, structured logs, and explicit dependencies. |
| Accepted | As Hamel, I want the module layout to explain the system so that each file has one obvious job. | Suggested modules: `models.py`, `runner.py`, `market_data.py`, `checks.py`, `tradingagents_adapter.py`, `verdict.py`, `storage.py`, `settlement.py`, `monitor_alerts.py`, `cli.py`. |
| Accepted | As Hamel, I want CLI debugging commands so that I can inspect runs without relying only on the UI. | Example commands: `run SYMBOL`, `show RUN_ID`, `events RUN_ID`, `settle RUN_ID`. |
| Accepted | As Hamel, I want tests to read like examples so that they teach the behavior while protecting the contracts. | Prioritize artifact, verdict, freshness, storage, and settlement tests. |

Suggested module shape:

```text
market_lab/
  README.md
  models.py
  runner.py
  market_data.py
  checks.py
  tradingagents_adapter.py
  verdict.py
  storage.py
  settlement.py
  cli.py
  tests/
```

---

## Appendix

### Review Artifact Sketch

```json
{
  "schema_version": 1,
  "run_id": "market_lab_20260508T210000Z_AAPL",
  "symbol": "AAPL",
  "requested_at": "2026-05-08T21:00:00Z",
  "status": "done",
  "trust_verdict": "trusted|uncertain|blocked",
  "verdict_reasons": [],
  "facts": {
    "price": {
      "source": "market-data-service",
      "as_of": "2026-05-08T20:59:00Z",
      "freshness_seconds": 60,
      "market_session": "open|closed|pre_market|after_hours",
      "price_basis": "live|close|extended_hours|latest_available",
      "last_price": 0,
      "previous_close": 0,
      "day_change_pct": 0,
      "volume": 0
    },
    "indicators": {
      "momentum": "positive|negative|mixed|unavailable",
      "rsi": null,
      "macd": null
    },
    "optional_evidence": {
      "news": "available|missing|failed",
      "fundamentals": "available|missing|failed",
      "sentiment": "available|missing|failed"
    }
  },
  "interpretation": {
    "freshness": "fresh|stale|missing",
    "risk_flags": [],
    "deterministic_summary": "",
    "tradingagents_summary": "",
    "comparison": "agree|disagree|partial|unavailable"
  },
  "outcomes": {
    "spy_reference_price": 0,
    "windows": {
      "1d": { "status": "pending|settled", "raw_return_pct": null, "spy_return_pct": null, "alpha_vs_spy_pct": null },
      "5d": { "status": "pending|settled", "raw_return_pct": null, "spy_return_pct": null, "alpha_vs_spy_pct": null },
      "20d": { "status": "pending|settled", "raw_return_pct": null, "spy_return_pct": null, "alpha_vs_spy_pct": null }
    }
  }
}
```

### Open Questions

No blocking product questions remain for PRD review.

Technical implementation should still decide:

- exact SQLite schema
- exact market-hours calendar source
- exact TradingAgents invocation mode and timeout policy
- exact Mission Control route names
- Market Lab lives under the Trading Ops cockpit during the transition so trading review work has one home.
- exact Python package placement and CLI command names

### Non-Goals Repeated For Safety

Market Lab v0 is not a broker, not a paper portfolio, not a Telegram alerting system, and not a historical backtester. It is the first clean loop for review, trust, and outcome measurement.
