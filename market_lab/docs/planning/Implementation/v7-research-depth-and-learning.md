# Implementation Plan - Market Lab V7 Research Depth And Learning

**Document Status:** Proposed
**PRD:** [v7-research-depth-and-learning.md](../PRDs/v7-research-depth-and-learning.md)
**Tech Spec:** [v7-research-depth-and-learning.md](../TechSpecs/v7-research-depth-and-learning.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Source Quality | Existing sentiment collectors | Cleaner news/social evidence. |
| V2 - Momentum | Schwab/price history access | 1D/5D/20D/3M versus SPY before Codex. |
| V3 - Fundamentals | Provider selection | Valuation/earnings context when available. |
| V4 - Compact Codex Roles | V1-V3 | Role-based Codex review without token bloat. |
| V5 - Settlement Learning | Existing settlement records | Outcome memory informs future reviews safely. |
| V6 - Mission Control | V1-V5 | Research depth is understandable in the UI. |
| V7 - QA | All | Live and fixture paths are verified. |

## Verticals

### V1 - Source Quality

Files:

- `market_lab/market_lab/source_quality.py`
- `market_lab/market_lab/sentiment.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_source_quality.py`

Tasks:

- Normalize source results into `SourceItem`.
- Add StockTwits noise filters.
- Improve Reddit query construction with symbol and company name.
- Add source URL, timestamp, relevance score, and quality flags.
- Persist source-level failures without failing the run.

### V2 - Momentum

Files:

- `market_lab/market_lab/momentum.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_momentum.py`

Tasks:

- Fetch or load historical prices for symbol and SPY.
- Compute 1D, 5D, 20D, and 3M returns.
- Compute relative performance versus SPY.
- Mark incomplete windows as partial/missing.
- Add momentum snapshot to review artifacts before Codex.

### V3 - Fundamentals

Files:

- `market_lab/market_lab/fundamentals.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_fundamentals.py`

Tasks:

- Add provider adapter interface.
- Confirm provider source before implementation.
- Capture valuation, earnings, growth, margins, and analyst context when available.
- Mark unavailable fields explicitly.
- Add fundamentals snapshot to review artifacts before Codex.

### V4 - Compact Codex Roles

Files:

- `market_lab/market_lab/codex_packet.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_codex_packet.py`

Tasks:

- Stop sending full raw review artifacts to Codex.
- Build compact role-based packet.
- Add structured output schema for analyst role outputs.
- Require final judge to cite role evidence.
- Persist role outputs on the review.

### V5 - Settlement Learning

Files:

- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/outcome_memory.py`
- `market_lab/tests/test_outcome_memory.py`

Tasks:

- Aggregate settled outcomes by symbol and verdict.
- Track whether evidence-ready reviews beat SPY.
- Add sample-count thresholds.
- Expose early memory without over-weighting it.

### V6 - Mission Control

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`

Tasks:

- Expand news analysis with source links and timestamps.
- Add fundamentals panel.
- Add momentum-versus-SPY panel.
- Show role outputs clearly.
- Keep debug artifacts collapsed near the Market Lab header.
- Keep layout compact and readable.

### V7 - QA

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

Live smoke:

- run AAPL with live Schwab price
- verify source collection
- verify momentum windows
- verify fundamentals behavior
- attach Codex role review
- settle when due
- confirm outcome memory updates only after settlement
