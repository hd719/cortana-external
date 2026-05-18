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

## How The Goals Map To The Build

The wording above is intentionally high level. This is how it becomes concrete:

- **Better source quality** maps to PRD-R1, PRD-R2, and PRD-R3. V1 adds cleaner Yahoo/StockTwits/Reddit evidence, then V6 renders that evidence in Mission Control.
- **Real fundamentals** maps to PRD-R4. V3 adds a `FundamentalsSnapshot`, then V6 shows it. This is not a buy/sell decision. It is a company fact sheet that tells the analyst whether valuation, earnings, growth, margins, and analyst context are available and usable.
- **Momentum versus SPY** maps to PRD-R5. V2 computes deterministic 1D, 5D, 20D, and 3M performance before Codex reviews the run, so Codex is not guessing whether the symbol is outperforming the market.
- **Analyst-style Codex review** maps to PRD-R6 and PRD-R7. V4 turns the packet into compact role sections: price, news, fundamentals, risk, and final judge.
- **Learning from outcomes** maps to PRD-R8. V5 uses settled 1D, 5D, and 20D outcomes to build memory, but only changes confidence once enough samples exist.
- **Readable cockpit** maps to PRD-R9. V6 decides how the new evidence appears in Mission Control without overwhelming the Market Lab tab.

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
| PRD-R4 | Fundamentals Snapshot | Show verified fundamentals, or clearly explain which fundamental fields are missing. |
| PRD-R5 | Momentum Snapshot | Compute stock-vs-SPY momentum before Codex reviews the run. |
| PRD-R6 | Role Outputs | Persist role-specific analysis for price, news, fundamentals, risk, and final judge. |
| PRD-R7 | Compact Codex Packet | Send Codex only decision evidence, not the full raw review or portfolio payload. |
| PRD-R8 | Settlement Learning | Use settled review outcomes to build memory, but do not let small sample sizes drive decisions. |
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

A `FundamentalsSnapshot` is the company fact sheet for a Market Lab run. It answers:

- Is the company expensive or cheap by basic valuation measures?
- When are earnings, and what did the last earnings data say?
- Are revenue, earnings, and margins improving or weakening?
- Is there analyst context available, such as consensus rating or target trend?

The snapshot does **not** decide "buy" or "no buy" by itself. It gives the Fundamentals analyst and final judge verified company context. If Market Lab cannot fetch a value from a free/reliable source, it records that field in `unavailable_fields` instead of guessing.

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

## Runtime Data Locations

Market Lab data is local and file-backed first, with SQLite as the run index.

- Default cache root: `<repo>/.cache/market_lab`
- Override: `MARKET_LAB_CACHE_DIR`
- Run index database: `<cache-root>/market_lab.sqlite`
- Per-run artifacts: `<cache-root>/runs/<run_id>/`

When Mission Control is running separate prod/dev environments, each environment should use its own cache root through `MARKET_LAB_CACHE_DIR`, for example:

- Prod: `<repo>/.cache/market_lab/prod`
- Dev: `<repo>/.cache/market_lab/dev`
- CI/test: `<repo>/.cache/market_lab/ci`

That means an environment-specific run usually lives at:

```text
<repo>/.cache/market_lab/<env>/runs/<run_id>/
```

V7 should keep new evidence artifacts in the run folder so a single run is easy to inspect:

| Artifact | Purpose |
|----------|---------|
| `review.json` | Main Market Lab review artifact. |
| `events.jsonl` | Timeline/run path events. |
| `logs.txt` | Run logs and errors. |
| `codex-review-packet.md` | Compact packet sent to Codex. |
| `codex-review.md` | Attached Codex second opinion. |
| `source-quality.json` | Filtered news/sentiment evidence and source status. |
| `fundamentals.json` | `FundamentalsSnapshot` for the symbol. |
| `momentum.json` | Symbol-vs-SPY momentum windows. |
| `outcome-memory.json` | Prior settlement summary for the symbol. |

Shared/generated caches can live outside a run when they are reused:

- Sentiment/source cache: `<cache-root>/sentiment/<symbol>/<source>/`
- Opportunity boards: `<cache-root>/opportunities/<board_id>/opportunities.json`
- Evidence snapshots: `<cache-root>/evidence/<symbol>/<timestamp>.json`
- Read-only Schwab portfolio cache: `<cache-root>/portfolio/schwab-portfolio-latest.json`
- Raw Schwab portfolio payloads: `<cache-root>/portfolio/raw/`

## How The Ledger Gets Updated

Market Lab updates this ledger through normal UI/API/CLI actions:

| Action | What Updates |
|--------|--------------|
| Run a symbol from Mission Control or `market_lab.cli run <symbol>` | Creates a SQLite row in `market_lab.sqlite`, creates `<cache-root>/runs/<run_id>/`, writes `review.json`, `events.jsonl`, and `logs.txt`. |
| Collect source/fundamental/momentum evidence | Writes V7 evidence artifacts into the same run folder and updates `review.json`. |
| Ask Codex | Writes `codex-review-packet.md`, starts/links the Codex session, then writes `codex-review.md` when the review is attached. |
| Settle one run | Updates that run's settlement rows in SQLite and refreshes the settlement section in `review.json`. |
| Settle due | Finds all due 1D/5D/20D windows, updates SQLite settlement rows, and refreshes each affected run artifact. |
| Refresh Schwab portfolio | Updates `<cache-root>/portfolio/schwab-portfolio-latest.json`; runs can then reference that snapshot as portfolio context. |

The SQLite database is the index. The run folder is the readable evidence packet. Mission Control should read both: SQLite for listing/searching runs, and the run folder for the detailed review artifacts.

## Success Criteria

- News panel shows meaningful source links and timestamps.
- StockTwits errors are handled as source-level failures, not whole-run failures.
- Reddit results are symbol-aware.
- Momentum versus SPY is visible before Codex review.
- Fundamentals are visible when available and clearly marked when missing.
- Codex packet is compact and role-based.
- Role outputs are persisted and shown in Mission Control.
- Settlement learning can answer: "Have prior evidence-ready reviews for this symbol beaten SPY?"
