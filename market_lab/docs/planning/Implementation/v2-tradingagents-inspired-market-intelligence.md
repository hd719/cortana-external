# Implementation Plan - Market Lab V2 TradingAgents-Inspired Market Intelligence

**Document Status:** Implemented in PR #346
**PRD:** [v2-tradingagents-inspired-market-intelligence.md](../PRDs/v2-tradingagents-inspired-market-intelligence.md)
**Tech Spec:** [v2-tradingagents-inspired-market-intelligence.md](../TechSpecs/v2-tradingagents-inspired-market-intelligence.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Evidence Snapshot Contract | Market Lab V1 | One symbol can produce a richer bounded evidence object. |
| V2 - Outcome Memory | Existing settlement data | Prior outcomes can be summarized for packets and UI. |
| V3 - Token Budget Modes | Evidence + Codex packet | Quick/deep review modes keep Codex usage controlled. |
| V4 - Safer Review Labels | Existing verdict fields | UI/product copy uses Evidence Ready, Needs More Context, and Blocked. |
| V5 - Mission Control Rendering | V1-V4 | UI shows evidence, memory, token mode, and context quality. |
| V6 - QA/E2E | All previous | Full review and settlement loop is verified. |

---

## Recommended Commit Structure

```text
Commit 1: Evidence snapshot models and builder
Commit 2: Grounded sentiment sources
Commit 3: Settlement memory summaries
Commit 4: Token budget modes and Codex packet upgrade
Commit 5: Safer review labels
Commit 6: Mission Control V2 UI
Commit 7: Tests, docs, E2E smoke
```

---

## Vertical 1 - Evidence Snapshot Contract

Outcome: Market Lab can create a bounded evidence packet before Codex sees anything.

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/evidence.py`
- `market_lab/market_lab/runner.py`
- `market_lab/tests/test_evidence.py`

Tasks:

- Add `EvidenceSnapshot`.
- Build price/SPY summaries from existing market-data facts.
- Include market-hours/off-hours basis.
- Include deterministic check summary.
- Add optional placeholders for fundamentals, news, sentiment, and risk.
- Persist evidence snapshot path in `review.json`.

Tests:

- Snapshot includes symbol price and SPY reference.
- Missing optional evidence is labeled, not invented.
- Stale required evidence remains a blocker.

---

## Vertical 2 - Grounded Sentiment Sources

Outcome: Market Lab can give Codex real sentiment inputs instead of asking it to imagine social/news context.

Files:

- `market_lab/market_lab/sentiment_sources.py`
- `market_lab/market_lab/models.py`
- `market_lab/market_lab/evidence.py`
- `market_lab/tests/test_sentiment_sources.py`

Tasks:

- Add `SentimentSourceResult`.
- Add `SentimentSnapshot`.
- Fetch Yahoo Finance news when available.
- Fetch StockTwits cashtag messages when available.
- Fetch Reddit finance subreddit posts when available.
- Use yfinance news first for Yahoo Finance.
- Use the public StockTwits symbol stream endpoint first.
- Use Reddit RSS/search first; defer OAuth/PRAW until RSS is proven insufficient.
- Defer X/Twitter.
- Return source-level `available`, `empty`, `missing`, `rate_limited`, or `error` status.
- Add local cache with 30-60 minute TTL.
- Persist request URL/fetch method and rate-limit headers when available.
- Persist raw/summary sentiment artifacts when useful.

Tests:

- Yahoo/StockTwits/Reddit available states validate.
- Empty source results do not fail the review.
- Source errors are labeled and do not crash the run.
- HTTP 429 maps to `rate_limited`.
- Cache hit avoids a second network call in the same TTL.
- X/Twitter is not called in V2.

---

## Vertical 3 - Outcome Memory

Outcome: Market Lab can summarize what happened after prior reviews.

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/memory.py`
- `market_lab/market_lab/storage.py`
- `market_lab/tests/test_memory.py`

Tasks:

- Add `OutcomeMemorySummary`.
- Query prior same-symbol runs.
- Summarize settled count, success rate, average alpha, and common missing context.
- Include sample size caveats.
- Attach summary to new reviews and Codex packets.

Tests:

- Empty history returns a safe no-history summary.
- Mixed settled outcomes compute success rate and average alpha.
- Pending windows do not count as settled outcomes.

---

## Vertical 4 - Token Budget Modes

Outcome: Codex packet size is deliberate.

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/token_budget.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/cli.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Add `TokenBudgetSummary`.
- Add `--mode quick|deep` to `codex-packet`.
- Default to `quick`.
- Include omitted sections explicitly.
- Record estimated context size if practical.

Tests:

- Quick packets omit deep excerpts.
- Deep packets include outcome memory and richer evidence.
- Deep packets include grounded sentiment source summaries when available.
- Packets forbid Codex from inventing unavailable social/news data.
- Packet tells Codex what was omitted.

---

## Vertical 5 - Safer Review Labels

Outcome: Market Lab stops implying that a review is “safe to buy.”

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/verdict.py`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `market_lab/tests/test_verdict.py`

Tasks:

- Keep backward compatibility with existing `trusted`, `uncertain`, and `blocked` stored artifacts.
- Add display labels: `Evidence Ready`, `Needs More Context`, and `Blocked`.
- Prefer new names in V2 docs, UI copy, and future context fields.
- Avoid BUY/safe/profit language.

Tests:

- Existing artifacts still load.
- UI renders safer labels.
- API responses remain backward-compatible.

---

## Vertical 6 - Mission Control Rendering

Outcome: V2 is understandable from the UI.

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`

Tasks:

- Render evidence quality.
- Render source-level sentiment status.
- Render prior outcome memory.
- Render token mode.
- Render safer review labels.
- Keep debug artifacts collapsed.

Tests:

- Prior memory renders sample size and alpha.
- Sentiment source status renders without implying missing data is a fatal error.
- Missing optional context renders without red-error semantics.

---

## Vertical 7 - QA And E2E

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm test app/market-lab/market-lab-client.test.tsx lib/market-lab.test.ts
cd apps/mission-control && pnpm build
```

Manual smoke:

1. Start a one-symbol review.
2. Ask Codex in quick mode.
3. Ask Codex in deep mode on the same run or a new run.
4. Confirm Mission Control renders evidence, roles, memory, safer labels, and token mode.
5. Let scheduled settlement score due windows.
6. Confirm monitor alert includes the settled alpha-vs-SPY result.

---

## Scope Boundaries

In scope:

- richer evidence packets
- grounded Yahoo Finance, StockTwits, and Reddit sentiment inputs
- settlement memory
- token budget modes
- safer review labels
- Mission Control rendering
- tests and docs

Out of scope:

- full market scan
- watchlist/opportunity board
- portfolio intelligence
- X/Twitter sentiment
- broker execution
- paper trading
- paid TradingAgents/OpenAI API fanout
- automatic BUY/SELL alerts
- old backtester dependencies
