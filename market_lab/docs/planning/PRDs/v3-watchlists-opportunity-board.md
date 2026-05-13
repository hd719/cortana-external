# Market Lab V3 Watchlists And Opportunity Board PRD

**Document Status:** Implemented in PR #346
**Owner:** Trading systems
**Last Updated:** 2026-05-12
**Depends On:** Market Lab V2 single-symbol intelligence

## Problem / Opportunity

Mission Control already has a Watchlists tab, but it currently shows retired legacy data. V3 should turn that tab into the Market Lab idea-discovery surface.

V2 answers:

```text
How good is this one symbol review?
```

V3 answers:

```text
Which symbols from my watchlists deserve review today?
```

## Goals

- Use the existing Mission Control Watchlists tab.
- Rank bounded watchlists without calling Codex for every symbol.
- Explain why each candidate deserves review, needs more context, or is blocked.
- Let the operator start a one-symbol Market Lab review from a candidate.

## Non-Goals

- Full-market scanning.
- Portfolio holdings/exposure logic.
- Broker execution.
- Paper trading.
- Automatic Codex fanout.
- BUY/SELL recommendations.

## Requirements

| Requirement | Description |
|-------------|-------------|
| Named Watchlists | Support configured lists such as core, AI/semis, high beta, defensive, and custom lists. |
| Deterministic Ranking | Score symbols using an adjustable points model based on evidence snapshots, blockers, momentum, and prior outcome memory. |
| Adjustable Weights | Scoring defaults must be configurable through environment variables so the model can be tuned without code changes. |
| Candidate Explanation | Show reasons, blockers, and missing context for each ranked symbol. |
| Review Handoff | Provide a `Run Market Lab Review` action that starts the one-symbol review flow. |
| No Codex Fanout | Watchlist ranking must not start Codex sessions by default. |
| Existing Tab | Replace the retired Watchlists card in Trading Ops. |

## Scoring Model

V3 scoring is not a trade signal. It is a review-priority score:

```text
candidate_score = evidence_quality + momentum + outcome_memory - missing_context - risk_penalties
```

Default scoring should use a 100-point scale with adjustable weights.

| Component | Points | Meaning |
|-----------|--------|---------|
| Fresh price + SPY | +20 | Can we evaluate it right now? |
| No hard blockers | +10 | No stale/missing required evidence. |
| Momentum vs SPY | -10 to +25 | Is symbol outperforming SPY over recent windows? |
| Outcome memory | -10 to +20 | Have past evidence-ready reviews for this symbol beaten SPY? |
| Missing context | 0 to -15 | Missing news/sentiment/fundamentals lowers confidence. |
| Risk flags | 0 to -30 | Earnings soon, high volatility, stale data, etc. |

Initial labels:

| Score | Label |
|-------|-------|
| 80-100 | Review Priority High |
| 60-79 | Review Priority Medium |
| 40-59 | Review Priority Low |
| below 40 | Skip / Needs Context |
| hard blocker | Blocked |

Example:

```text
AAPL
Fresh price + SPY: +20
No hard blockers: +10
Momentum vs SPY: +18
Outcome memory: +12
Missing sentiment: -5
Risk flags: 0

Score: 55
Label: Review Priority Low
```

The score means:

```text
This symbol may be worth reviewing before lower-ranked symbols in the same watchlist.
```

It does not mean:

```text
Buy this stock.
```

## User Stories

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want the Watchlists tab to show useful Market Lab candidates instead of retired backtester data. | Use the current tab. |
| Accepted | As Hamel, I want to rank a small watchlist so I know what to inspect first. | Bounded symbols only. |
| Accepted | As Hamel, I want to see why a symbol ranked high or low. | Reasons and blockers are required. |
| Accepted | As Hamel, I want to start a deeper review from a candidate. | Opens/starts V2 review. |

## Success Criteria

- Watchlists tab shows at least one configured watchlist.
- Candidate ranking works without Codex.
- Each candidate shows score, reasons, blockers, and missing context.
- Score components are visible enough to explain the rank.
- Scoring weights are adjustable without code changes.
- Operator can start a Market Lab review from a candidate.
- UI copy uses review language, not trade commands.
