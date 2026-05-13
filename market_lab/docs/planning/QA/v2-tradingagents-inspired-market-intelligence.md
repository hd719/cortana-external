# QA Plan - Market Lab V2 TradingAgents-Inspired Market Intelligence

**Document Status:** Implemented in PR #346
**PRD:** [v2-tradingagents-inspired-market-intelligence.md](../PRDs/v2-tradingagents-inspired-market-intelligence.md)
**Tech Spec:** [v2-tradingagents-inspired-market-intelligence.md](../TechSpecs/v2-tradingagents-inspired-market-intelligence.md)
**Implementation Plan:** [v2-tradingagents-inspired-market-intelligence.md](../Implementation/v2-tradingagents-inspired-market-intelligence.md)

## QA Goal

Prove that V2 improves one-symbol Market Lab reviews toward a TradingAgents-inspired research desk without losing the current safety model: bounded evidence, explicit missing context, manual Codex, settlement-backed learning, safer labels, and no execution.

---

## Automated QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Evidence | Fresh Schwab price and SPY reference are available | Evidence snapshot includes both with source and basis. |
| Evidence | Optional news/sentiment is unavailable | Snapshot marks it missing; review does not fail. |
| Evidence | Required market data is stale | Deterministic verdict remains blocked. |
| Sentiment | Yahoo Finance news available | Source result is `available` with sample count or summary. |
| Sentiment | StockTwits messages available | Source result includes sample count and bullish/bearish/no-label context. |
| Sentiment | Reddit posts available | Source result includes subreddit, score/comment metadata, and excerpts. |
| Sentiment | Source is empty or errors | Review continues with source-level `empty` or `error` status. |
| Sentiment | Provider returns HTTP 429 | Source result is `rate_limited`; review continues. |
| Sentiment | Same symbol fetched twice inside TTL | Second run uses cache instead of another provider request. |
| Sentiment | X/Twitter requested | V2 does not call X/Twitter. |
| Memory | No prior runs exist | Outcome memory says no history with zero settled count. |
| Memory | Prior settled evidence-ready reviews exist | Summary includes success rate and average alpha vs SPY. |
| Memory | Prior windows are pending | Pending windows are excluded from settled metrics. |
| Token Budget | Quick mode packet | Packet is compact and lists omitted deep sections. |
| Token Budget | Deep mode packet | Packet includes richer evidence and prior outcome context. |
| Codex Packet | Missing context exists | Packet tells Codex not to invent unavailable facts. |
| Codex Packet | Prior outcomes exist | Packet asks Codex to compare current review against settlement history. |
| Codex Packet | Sentiment source missing | Packet forbids claiming that source has sentiment. |
| Labels | Review is evidence-ready | UI says Evidence Ready, not Trusted. |
| Labels | Review needs more evidence | UI says Needs More Context, not Uncertain. |
| UI | Evidence snapshot loaded | Evidence quality panel renders. |
| UI | Outcome memory loaded | Prior performance panel renders sample size and alpha. |
| UI | Debug data exists | Raw artifact paths stay collapsed by default. |
| Safety | Codex optimistic with blocker | Hard gate remains authoritative. |
| Safety | Review renders | Copy avoids BUY/SELL language. |

---

## Required Commands

Run from repo root:

```bash
uv run --project market_lab pytest market_lab/tests
```

Run from Mission Control:

```bash
cd apps/mission-control
pnpm test app/market-lab/market-lab-client.test.tsx lib/market-lab.test.ts
pnpm build
```

---

## Manual Smoke

### Scenario 1 - Rich One-Symbol Review

1. Run a new review:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --json
```

2. Generate a quick Codex packet.
3. Attach Codex review.
4. Open Market Lab in Mission Control.

Expected:

- Evidence snapshot exists.
- Codex sees price, SPY, hard gates, missing context, and outcome memory.
- UI shows final judge, roles, evidence quality, missing context, and token mode.

---

### Scenario 2 - Deep Review Mode

1. Generate a deep Codex packet for a recent run.
2. Attach the deep review.
3. Compare UI against quick mode.

Expected:

- Deep mode includes more prior context.
- Token budget summary says what was included.
- Review remains artifact-backed.

---

### Scenario 3 - Grounded Sentiment

1. Run a review with Yahoo Finance, StockTwits, and Reddit fetchers enabled.
2. Inspect the evidence artifact and Codex packet.

Expected:

- Each source has `available`, `empty`, `missing`, or `error` status.
- Rate-limited sources use `rate_limited` status.
- Cached source results are reused inside the configured TTL.
- Codex packet includes only fetched source data.
- Codex packet does not mention X/Twitter as an available source.
- Missing sources are visible but do not automatically block the review.

---

### Scenario 4 - Outcome Memory

1. Use a symbol with prior settled windows.
2. Run a new review.
3. Inspect `review.json` and UI.

Expected:

- Prior settled count is visible.
- Average alpha vs SPY is visible when available.
- Pending windows are not counted as settled.
- Small samples are clearly labeled.

---

### Scenario 5 - Safer Labels

1. Open a run that would previously display `trusted`.
2. Open a run that would previously display `uncertain`.

Expected:

- UI displays `Evidence Ready`.
- UI displays `Needs More Context`.
- Stored artifacts remain backward-compatible.

---

### Scenario 6 - Safety Regression

1. Use a fixture or fake market-data client that produces stale required data.
2. Build evidence and Codex packet.
3. Attach a bullish Codex review.

Expected:

- Market Lab deterministic verdict remains `blocked`.
- UI shows the blocker.
- Codex does not overwrite hard-gate truth.

---

## Regression Checks

- Existing V0/V1 run artifacts still load.
- `Ask Codex` remains manual by default.
- `settle-due` behavior is unchanged.
- Monitor Telegram settlement alerts still send only for newly settled due windows.
- Old backtester modules are not imported.
- No Alpaca/FRED dependency returns.
- No broker execution API is called.
- No paper-trade model is introduced.
- Watchlist/opportunity-board work is not introduced in V2.
- Portfolio holdings/exposure work is not introduced in V2.
- X/Twitter sentiment is not introduced in V2.
- Codex cannot claim Reddit/StockTwits/Yahoo sentiment unless those source blocks exist.
- Review copy avoids BUY/SELL wording.

---

## QA Exit Criteria

V2 is ready for implementation review when:

- Python tests pass.
- Mission Control tests pass.
- Mission Control build passes.
- One live one-symbol quick review works.
- One live deep review works.
- One settlement-memory example is visible.
- Hard-gate precedence is covered by tests.
- Token mode, safer labels, and missing-context behavior are visible in UI.
