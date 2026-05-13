# Market Lab V2 TradingAgents-Inspired Market Intelligence PRD

**Document Status:** Implemented in PR #346
**Owner:** Trading systems
**Last Updated:** 2026-05-12
**Depends On:** Market Lab V0, Market Lab V1 Codex Analyst Committee, Schwab market-data lane, settlement history

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | Hamel |
| Epic | Market Lab V2 |

---

## Problem / Opportunity

Market Lab now has the clean loop the old backtester never made obvious:

```text
review idea -> explain evidence -> ask Codex -> settle outcome -> learn
```

That is the right foundation, but it is not yet TradingAgents-like. TradingAgents is valuable because it separates viewpoints, uses richer market context, and turns one broad LLM answer into something closer to an investment committee. Market Lab V2 should bring that shape into our own system without returning to the old backtester, adding broker execution, paying for OpenAI API credits, or trusting a persuasive model answer without measured evidence.

V2 goal:

> Make one-symbol Market Lab reviews feel like a practical TradingAgents-inspired research desk: richer inputs, clearer analyst roles, memory from settled outcomes, safer review labels, and controlled Codex cost.

---

## Current State

Already available:

- Market Lab Python package with run, show, event, Codex packet, attach, settlement, and monitor-alert CLI flows.
- Schwab-backed live price facts and SPY benchmark comparison.
- Trust verdicts currently stored as `trusted`, `uncertain`, `blocked`.
- Mission Control Market Lab tab.
- Manual `Ask Codex` flow.
- Structured Codex analyst committee contract from V1.
- 1D/5D/20D settlement windows.
- OpenClaw monitor Telegram alerts when newly due windows settle.
- SQLite run index plus filesystem artifacts under `.cache/market_lab/`.
- Old backtester retired from the active cockpit.

Current gaps:

- Codex still sees limited evidence: mostly price, SPY, deterministic checks, prior runs, and optional missing-context labels.
- Analyst roles exist in structure, but not yet as a deeper multi-stage committee.
- Settlement exists, but the system does not yet summarize past settled outcomes inside new reviews.
- Review labels use `trusted`, which can sound too close to “safe to buy.”
- Token usage can be high because packets are not tiered into quick versus deep modes.
- Market Lab cannot yet answer: “For this one symbol, what evidence is ready, what context is missing, and how did similar reviews perform?”

---

## Success Metrics

Product success:

- Market Lab can produce a richer research packet for one symbol using price, SPY, recent momentum, fundamentals availability, news/sentiment summaries, risk flags, prior same-symbol reviews, and prior settlements.
- Codex output clearly separates analyst roles and final judge reasoning.
- Mission Control shows why a review is evidence-ready, needs more context, or blocked without requiring markdown spelunking.
- Market Lab can show prior same-symbol outcome memory inside a new single-symbol review.
- Codex can run in quick or deep mode with visible context tradeoffs.

Measurement success:

- Settled outcomes can be grouped by verdict, confidence band, symbol, role stance, and missing-context type.
- Market Lab can show whether evidence-ready reviews beat SPY more often than needs-more-context reviews.
- Market Lab can show whether missing news/fundamentals/sentiment correlated with bad evidence-ready reviews.
- Token usage per review is visible and capped by mode.

Operator trust success:

- Hard data blockers still win over Codex optimism.
- No automatic trade execution.
- No paper trading.
- No BUY language in Market Lab review output.
- No automatic deep Codex review unless explicitly enabled later.

---

## Assumptions

- Schwab remains the required market-data lane for live prices.
- SPY remains the primary benchmark for stock-specific alpha measurement.
- Codex CLI remains the preferred LLM engine because it uses the subscription path rather than API credits.
- TradingAgents is inspiration, not a dependency for V2.
- Market Lab should be usable when news/sentiment providers are missing, but it must label those gaps.
- Initial grounded sentiment sources are Yahoo Finance news, StockTwits cashtag messages, and Reddit finance subreddit posts.
- X/Twitter is deferred until there is a clear API/cost/access plan.
- Source-fetching should use free/no-key paths first, but V2 must not assume any external source is truly unlimited or immune to throttling.
- V2 is still review-only. Execution candidates come later behind separate approval boundaries.
- Watchlist ranking is V3.
- Portfolio intelligence is V4.
- Execution readiness is V5.

---

## Non-Goals

V2 does not include:

- real broker execution
- paper trading
- paid OpenAI API integration
- direct TradingAgents runtime dependency
- full historical backtesting
- automated portfolio rebalancing
- automatic BUY/SELL alerts
- watchlist/opportunity-board ranking
- portfolio holdings/exposure intelligence
- resurrecting old backtester modules
- unbounded watchlist scans

---

## High-Level Requirements

| Requirement | Description |
|-------------|-------------|
| Rich Evidence Packet | Add bounded research context beyond price/SPY: recent momentum, fundamentals snapshot, news/sentiment summary, risk flags, and prior outcome history. |
| Analyst Committee Upgrade | Move from one structured Codex pass toward explicit role sections that resemble a lightweight research committee. |
| Outcome Memory | Use settled 1D/5D/20D outcomes to summarize how prior evidence-ready and needs-more-context reviews performed. |
| Grounded Sentiment Sources | Fetch real Yahoo Finance news, StockTwits, and Reddit data before Codex analyzes sentiment. |
| Safer Review Labels | Prefer `evidence_ready`, `needs_more_context`, and `blocked` language in UI/product docs. |
| Token Budget Modes | Add quick and deep review modes so Codex context is deliberate and measurable. |
| Provider Boundaries | Keep external data providers behind small adapters and cache raw snapshots as artifacts. |
| Mission Control Upgrade | Render evidence, roles, prior outcomes, and token mode clearly for one selected symbol. |
| Trust Guardrails | Preserve hard gates and keep Codex subordinate to deterministic evidence checks. |

---

## User Stories

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want a richer packet before Codex reviews a stock so that evidence-ready means more than fresh price data. | Include bounded evidence, not an unbounded internet scrape. |
| Accepted | As Hamel, I want analyst roles to feel like a committee so that price action, fundamentals, news/sentiment, risk, and final judge do not blur together. | Inspired by TradingAgents. |
| Accepted | As Hamel, I want Market Lab to remember whether prior evidence-ready reviews actually beat SPY so that confidence becomes earned. | Use settlement history. |
| Accepted | As Hamel, I want the UI to avoid `trusted` if that sounds like `safe to buy`. | Display `Evidence Ready`, `Needs More Context`, and `Blocked`. |
| Accepted | As Hamel, I want quick and deep Codex modes so that token spend does not explode. | Default should stay tight. |
| Accepted | As Hamel, I want missing context shown honestly so that Codex cannot sound certain when the evidence is thin. | Missing evidence is part of the product. |
| Accepted | As Hamel, I want sentiment to be based on real source data, not Codex imagination. | Start with Yahoo Finance, StockTwits, and Reddit. |
| Accepted | As Hamel, I want Telegram only for meaningful monitor events so that alerts stay useful. | Settlement and degraded runtime only unless later expanded. |

---

## Product Shape

V2 should make a single-symbol Market Lab review answer three questions:

1. Is the live evidence ready enough to evaluate this review seriously?
2. What does each analyst lens see?
3. How have similar reviews performed after settlement?

The UI should emphasize:

- current verdict and confidence
- evidence quality
- analyst role agreement/disagreement
- prior same-symbol outcomes
- alpha versus SPY history
- token mode and context size

Initial sentiment source plan:

```text
Yahoo Finance news = institutional/news framing via yfinance news first
StockTwits = fast retail cashtag stream via public symbol stream endpoint
Reddit = community discussion via official RSS/search feed first, OAuth/PRAW later only if needed
X/Twitter = deferred
```

Codex should only analyze sentiment sources Market Lab actually fetched. If a source is missing, blocked, rate-limited, or empty, the packet should say that plainly.

Research finding:

```text
No chosen source should be documented as "unlimited."
Yahoo/yfinance is free and no-key, but unofficial/personal-use and can fail or throttle.
StockTwits symbol stream is reachable without a key today, but API registration is currently under review and availability can change.
Reddit RSS/search is free/no-key for light use, while official API/OAuth has rate limits.
```

V2 should therefore design for low request volume, local caching, and source-level `rate_limited` status instead of depending on unlimited access.

---

## TradingAgents Comparison

Market Lab should borrow these ideas:

- separated analyst viewpoints
- risk reviewer before final decision
- memory/reflection from prior outcomes
- structured outputs that can be compared over time
- final judge that synthesizes disagreement

Market Lab should not copy these pieces yet:

- paid LLM API fanout
- broad autonomous trading workflow
- direct paper trading assumptions
- unbounded multi-agent chatter
- opaque decisions not tied to saved artifacts

---

## Open Questions Answered

| Question | Decision |
|----------|----------|
| Should V2 depend on TradingAgents directly? | No. Use it as product inspiration; keep Market Lab native and Codex-based. |
| Should Codex run automatically? | No by default. Deep Codex remains operator-triggered unless explicitly enabled later. |
| Should missing news/sentiment block trust? | Not by itself. It should lower context quality and be visible. |
| Which sentiment sources should V2 start with? | Yahoo Finance news, StockTwits cashtag messages, and Reddit finance subreddit posts. |
| Should V2 include X/Twitter? | No. Defer X/Twitter until API access, cost, and data quality are clear. |
| Are these sources guaranteed free and rate-limit-free? | No. V2 uses free/no-key paths first, but treats throttling as expected operational reality. |
| Should V2 include watchlists? | No. Watchlist ranking belongs in V3 and should use the existing Mission Control Watchlists tab. |
| Should V2 include portfolio context? | No. Portfolio intelligence belongs in V4 because holdings/exposure answer a different question than idea research. |
