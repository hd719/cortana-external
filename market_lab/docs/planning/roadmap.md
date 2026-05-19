# Market Lab Roadmap

**Document Status:** Lightweight roadmap  
**Last Updated:** 2026-05-19

## Implementation Progress

V2 through V7 are implemented:

- V2 adds evidence snapshots, grounded optional sentiment source adapters, outcome memory, token-budgeted Codex packets, and safer Evidence Ready / Needs More Context / Blocked labeling.
- V3 adds deterministic watchlists/opportunity boards with configurable scoring and no Codex fanout.
- V4 adds read-only Schwab portfolio context with cached snapshot support and no order endpoints.
- V5 adds execution intents, approvals/rejections, and a broker adapter boundary with `validate_intent` and `preview_order` only. No order placement is implemented.
- V6 separates prod/dev Market Lab data and Mission Control runtime environments.
- V7 adds source quality, source timestamps/links, fundamentals, momentum versus SPY, structured analyst roles, and settlement-backed learning.

V8 is currently planned as the Market Lab Decision Committee:

- specialist analyst outputs
- bull/bear debate
- research manager synthesis
- aggressive/neutral/conservative risk perspectives
- portfolio-aware final action decision
- settlement reflections that feed future reviews
- no broker order placement

Current QA:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm test lib/market-lab.test.ts
cd apps/mission-control && pnpm build
MARKET_LAB_SENTIMENT_ENABLED=0 uv run --project market_lab python -m market_lab.cli opportunities --symbols AAPL,MSFT --json
uv run --project market_lab python -m market_lab.cli portfolio --json
```

This file summarizes the version ladder. Each formal version should have the full planning set:

```text
PRD
Tech Spec
Implementation Plan
QA Plan
```

## Formal Planning Sets

V2:

- [PRD](PRDs/v2-tradingagents-inspired-market-intelligence.md)
- [Tech Spec](TechSpecs/v2-tradingagents-inspired-market-intelligence.md)
- [Implementation Plan](Implementation/v2-tradingagents-inspired-market-intelligence.md)
- [QA Plan](QA/v2-tradingagents-inspired-market-intelligence.md)

V3:

- [PRD](PRDs/v3-watchlists-opportunity-board.md)
- [Tech Spec](TechSpecs/v3-watchlists-opportunity-board.md)
- [Implementation Plan](Implementation/v3-watchlists-opportunity-board.md)
- [QA Plan](QA/v3-watchlists-opportunity-board.md)

V4:

- [PRD](PRDs/v4-portfolio-intelligence.md)
- [Tech Spec](TechSpecs/v4-portfolio-intelligence.md)
- [Implementation Plan](Implementation/v4-portfolio-intelligence.md)
- [QA Plan](QA/v4-portfolio-intelligence.md)

V5:

- [PRD](PRDs/v5-execution-readiness.md)
- [Tech Spec](TechSpecs/v5-execution-readiness.md)
- [Implementation Plan](Implementation/v5-execution-readiness.md)
- [QA Plan](QA/v5-execution-readiness.md)

V6:

- [PRD](PRDs/v6-data-environment-separation.md)
- [Tech Spec](TechSpecs/v6-data-environment-separation.md)
- [Implementation Plan](Implementation/v6-data-environment-separation.md)
- [QA Plan](QA/v6-data-environment-separation.md)

V7:

- [PRD](PRDs/v7-research-depth-and-learning.md)
- [Tech Spec](TechSpecs/v7-research-depth-and-learning.md)
- [Implementation Plan](Implementation/v7-research-depth-and-learning.md)
- [QA Plan](QA/v7-research-depth-and-learning.md)

V8:

- [PRD](PRDs/v8-decision-committee.md)
- [Tech Spec](TechSpecs/v8-decision-committee.md)
- [Implementation Plan](Implementation/v8-decision-committee.md)
- [QA Plan](QA/v8-decision-committee.md)

## Future Directions

### V8 - Decision Committee

Turn richer V7 evidence into a committee-style action decision.

V8 should answer:

```text
Given the evidence, portfolio context, and prior outcomes, is this a buy candidate, wait, avoid, hold, or sell review?
```

Likely scope:

- evidence gate remains first
- price/news/fundamentals/portfolio/risk analyst outputs
- bull/bear debate
- research manager synthesis
- risk committee
- final action decision separate from evidence status
- settlement reflection memory
- idempotent Codex/agent sessions
- no autonomous execution
