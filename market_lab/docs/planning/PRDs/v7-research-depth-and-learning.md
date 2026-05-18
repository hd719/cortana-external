# Market Lab V7 Research Depth And Learning PRD

**Document Status:** Proposed
**Owner:** Trading systems
**Last Updated:** 2026-05-13
**Depends On:** Market Lab V2-V6

## Problem / Opportunity

Market Lab now has the right shape: live Schwab prices, Codex review, settlement tracking, watchlists, portfolio context, and execution-readiness boundaries. The next gap is research depth.

V2 already introduced analyst-style Codex sections. V7 makes those sections materially better by giving each role richer, cleaner, source-linked evidence before the final judge decides.

The goal is to move from "this artifact is evidence-ready" toward "this review explains why the setup matters, what could be wrong, and whether similar reviews have worked."

## Goals

- Improve news and sentiment quality before Codex sees it.
- Add source links, timestamps, relevance scores, and "why this matters" summaries.
- Add real fundamentals when free/reliable sources are available.
- Add momentum windows versus SPY before Codex review.
- Upgrade the Codex flow into clear role-based analysis:
  - Price analyst
  - News analyst
  - Fundamentals analyst
  - Risk analyst
  - Final judge
- Let settlement data accumulate into outcome memory and calibration.
- Keep Codex packets compact and avoid dumping full artifacts.

## Non-Goals

- Autonomous trading.
- Paid market-data subscriptions without approval.
- Reintroducing Alpaca, FRED, or the old backtester.
- Scraping sources in ways that violate terms of service.
- Trusting social sentiment without source quality filters.
- Letting Codex place orders or bypass V5 execution boundaries.

## Requirements

Use the requirement IDs below to trace this PRD into the Tech Spec and Implementation Plan.

| ID | Requirement | Description |
|----|-------------|-------------|
| PRD-R1 | Source Quality | Filter noisy StockTwits and low-signal Reddit/Yahoo results before analysis. |
| PRD-R2 | Source Attribution | Show source name, URL, title, timestamp, and relevance for each item. |
| PRD-R3 | News Summary | Summarize news into "why this matters" and separate catalysts from noise. |
| PRD-R4 | Fundamentals Snapshot | Capture valuation, earnings date, revenue/earnings trend, margins, and analyst estimates when available. |
| PRD-R5 | Momentum Snapshot | Compute 1D, 5D, 20D, and 3M returns for symbol and SPY before Codex review. |
| PRD-R6 | Role Outputs | Persist role-specific analysis for price, news, fundamentals, risk, and final judge. |
| PRD-R7 | Compact Codex Packet | Send Codex only decision evidence, not the full raw review or portfolio payload. |
| PRD-R8 | Settlement Learning | Use settled 1D/5D/20D outcomes to measure whether evidence-ready reviews beat SPY. |
| PRD-R9 | UI Clarity | Make news, fundamentals, momentum, and role outputs visible without overwhelming the cockpit. |

## Requirement Traceability

| PRD Requirement | Tech Spec Concept | Implementation Vertical |
|-----------------|-------------------|--------------------------|
| PRD-R1 Source Quality | `SourceItem`, `SourceQualitySnapshot`, Source Quality Module | V1 - Source Quality |
| PRD-R2 Source Attribution | `SourceItem.url`, `published_at`, `fetched_at`, relevance and source status fields | V1 - Source Quality, V6 - Mission Control |
| PRD-R3 News Summary | `SourceQualitySnapshot.why_this_matters`, source cautions, relevance scoring | V1 - Source Quality, V6 - Mission Control |
| PRD-R4 Fundamentals Snapshot | `FundamentalsSnapshot`, Fundamentals Module | V3 - Fundamentals, V6 - Mission Control |
| PRD-R5 Momentum Snapshot | `MomentumWindow`, `MomentumSnapshot`, Momentum Module | V2 - Momentum, V6 - Mission Control |
| PRD-R6 Role Outputs | `AnalystRoleOutput`, Role Flow | V4 - Compact Codex Roles, V6 - Mission Control |
| PRD-R7 Compact Codex Packet | Compact Codex Packet, packet caps, no raw artifact/portfolio dump | V4 - Compact Codex Roles |
| PRD-R8 Settlement Learning | `OutcomeMemorySummary`, Settlement Learning | V5 - Settlement Learning |
| PRD-R9 UI Clarity | Mission Control rendering of V1-V5 outputs | V6 - Mission Control |

## Source Quality

V7 should treat sources as evidence, not decoration.

Each source item should include:

- source name
- title or message excerpt
- URL when available
- published timestamp
- fetched timestamp
- relevance score
- symbol/company match reason
- sentiment label when available
- quality flags

StockTwits filtering should remove:

- empty or non-JSON responses
- spammy promotion posts
- unrelated cashtag spam
- emoji-only or ultra-low-text posts
- duplicate content
- posts without symbol relevance

Reddit queries should improve from generic finance subreddit scanning to symbol/company-aware searches.

## Fundamentals

Fundamentals should be free-source-first and provider-isolated. If a field cannot be fetched reliably, the artifact should mark it unavailable instead of inventing it.

Target fields:

| Area | Example Fields |
|------|----------------|
| Valuation | market cap, trailing P/E, forward P/E, price/sales |
| Earnings | next earnings date, latest EPS, EPS surprise if available |
| Trends | revenue growth, earnings growth |
| Quality | gross margin, operating margin, net margin |
| Analyst Context | consensus rating, price target, estimate trend if available |

## Momentum

Before Codex review, Market Lab should compute:

| Window | Question |
|--------|----------|
| 1D | Is the symbol moving better than SPY today? |
| 5D | Is short-term momentum improving or fading? |
| 20D | Is the symbol outperforming over about one trading month? |
| 3M | Is the larger trend stronger than SPY? |

Momentum should be deterministic and available before Codex is called.

## Codex Analyst Flow

V7 keeps Codex as the reviewer, but the packet should feel like a mini analyst committee:

```text
Price analyst
-> News analyst
-> Fundamentals analyst
-> Risk analyst
-> Final judge
```

Each role should receive compact evidence and return:

- stance: bullish, bearish, neutral, mixed
- confidence
- key reasons
- missing evidence
- blockers or cautions

The final judge must cite which roles matter most and whether the review is:

- trusted
- blocked
- uncertain

## Settlement Learning

Settlement remains the truth source for whether Market Lab is useful.

V7 should keep accumulating:

- review entry price
- SPY reference price
- 1D, 5D, and 20D symbol return
- 1D, 5D, and 20D SPY return
- relative performance versus SPY
- original verdict and role outputs
- whether the review was evidence-ready

Outcome memory should not overreact to tiny sample sizes. The UI can show early data, but scoring should require a minimum sample threshold before it changes confidence.

## Success Criteria

- News panel shows meaningful source links and timestamps.
- StockTwits errors are handled as source-level failures, not whole-run failures.
- Reddit results are symbol-aware.
- Momentum versus SPY is visible before Codex review.
- Fundamentals are visible when available and clearly marked when missing.
- Codex packet is compact and role-based.
- Role outputs are persisted and shown in Mission Control.
- Settlement learning can answer: "Have prior evidence-ready reviews for this symbol beaten SPY?"
