# QA Plan - Market Lab V7 Research Depth And Learning

**Document Status:** Proposed
**PRD:** [v7-research-depth-and-learning.md](../PRDs/v7-research-depth-and-learning.md)
**Tech Spec:** [v7-research-depth-and-learning.md](../TechSpecs/v7-research-depth-and-learning.md)
**Implementation Plan:** [v7-research-depth-and-learning.md](../Implementation/v7-research-depth-and-learning.md)

## QA Goal

Prove Market Lab has deeper, cleaner research evidence before Codex review and that settlement learning remains honest.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Source Quality | StockTwits returns invalid JSON | Source is marked failed; run continues. |
| Source Quality | StockTwits spam posts | Posts are filtered before Codex. |
| Source Quality | Reddit query fixture | Symbol/company-aware results are preferred. |
| Source Attribution | Source item is persisted | URL, timestamp, source, and relevance are present. |
| News Summary | Mixed-quality news | `why_this_matters` separates catalyst from noise. |
| Fundamentals | Provider has fields | Valuation, earnings, growth, margin, and analyst fields persist. |
| Fundamentals | Provider misses fields | Unavailable fields are explicit. |
| Momentum | Complete history | 1D/5D/20D/3M returns and SPY-relative returns are correct. |
| Momentum | Missing history | Window is `partial` or `missing`, not fabricated. |
| Codex Packet | Packet generated | Full raw review and full portfolio payload are absent. |
| Codex Roles | Codex review attached | Price/news/fundamentals/risk/final-judge outputs persist. |
| Settlement Learning | Fewer than threshold samples | Outcome memory displays early evidence only. |
| Settlement Learning | Threshold met | Beat-SPY rates and average relative returns are available. |
| UI | Run renders | News, fundamentals, momentum, roles, and settlement are visible. |

## Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

## Manual Smoke

1. Run Market Lab for `AAPL`.
2. Confirm the timeline includes source-quality and Codex role steps.
3. Confirm news shows links and timestamps.
4. Confirm StockTwits failure is source-scoped if it fails.
5. Confirm fundamentals show either real fields or explicit unavailable fields.
6. Confirm 1D, 5D, 20D, and 3M momentum versus SPY appears before Codex review.
7. Attach Codex review.
8. Confirm role outputs appear:
   - Price analyst
   - News analyst
   - Fundamentals analyst
   - Risk analyst
   - Final judge
9. Run settlement when due.
10. Confirm outcome memory updates only from settled production runs.

Expected:

- The run remains evidence-first.
- No source failure breaks the whole review.
- Codex receives a compact packet.
- Mission Control explains why the review matters.
- Outcome memory learns only from settled runs.
