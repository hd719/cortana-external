# QA Plan - Market Lab V8 Decision Committee

**Document Status:** Draft
**PRD:** [v8-decision-committee.md](../PRDs/v8-decision-committee.md)
**Tech Spec:** [v8-decision-committee.md](../TechSpecs/v8-decision-committee.md)
**Implementation Plan:** [v8-decision-committee.md](../Implementation/v8-decision-committee.md)

## QA Goal

Prove that Market Lab can produce a committee-style action decision without confusing evidence readiness with trade direction, spawning duplicate Codex sessions, or bypassing execution safety boundaries.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Evidence Gate | Fresh price and SPY, no blockers | Committee gate is `ready`. |
| Evidence Gate | Missing/stale core price | Committee gate is `blocked`; action cannot be `BUY_CANDIDATE`. |
| Decision Vocabulary | Evidence-ready bearish setup | Evidence status can be ready while action is `WAIT` or `AVOID`. |
| Analyst Outputs | Complete committee output | Price, news, fundamentals, portfolio, and risk roles parse. |
| Debate | Complete debate | Bull and bear cases parse with cited evidence. |
| Debate | Missing bear case | Artifact validation fails clearly. |
| Research Manager | Debate exists | Synthesis declares winning side or mixed/inconclusive. |
| Risk Committee | All perspectives present | Aggressive, neutral, and conservative risk outputs parse. |
| Portfolio Owned | Symbol is owned | Final decision includes portfolio implication. |
| Portfolio Unavailable | Schwab cache unavailable | Decision marks portfolio unavailable and does not pretend not-owned. |
| Final Decision | Complete output | Action, confidence, time horizon, invalidation points, missing evidence, and next trigger persist. |
| Idempotency | Click committee review twice | Second request returns existing running/attached state; no duplicate session. |
| Retry | Prior committee review failed | Retry is allowed. |
| Settlement Reflection | 1D/5D/20D/60D settles | Reflection artifact records alpha and compact lesson. |
| Memory Injection | Future run same symbol | Packet includes capped same-symbol lessons. |
| Execution Boundary | Committee says buy candidate | No broker order placement path is called. |
| UI | Committee artifact attached | Mission Control shows action decision, debate, risk, portfolio implication, and lessons. |

## Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm exec vitest run app/market-lab/market-lab-client.test.tsx app/api/market-lab/runs/[runId]/codex-review/route.test.ts lib/market-lab.test.ts
cd apps/mission-control && pnpm build
```

## Targeted Tests To Add

Python:

```bash
uv run --project market_lab pytest \
  market_lab/tests/test_codex_review.py \
  market_lab/tests/test_memory.py \
  market_lab/tests/test_settlement.py \
  market_lab/tests/test_broker_adapter.py
```

Mission Control:

```bash
cd apps/mission-control && pnpm exec vitest run \
  app/market-lab/market-lab-client.test.tsx \
  app/api/market-lab/runs/[runId]/codex-review/route.test.ts \
  lib/market-lab.test.ts
```

## Manual Dev Smoke

1. Open dev Mission Control.
2. Run Market Lab for one liquid symbol, for example `AAPL`.
3. Confirm V7 evidence appears:
   - price and SPY
   - news/sentiment
   - fundamentals
   - momentum
   - portfolio context
4. Start committee review.
5. Click the committee review button again while it is running.
6. Confirm the UI shows the existing session instead of creating another one.
7. Confirm the committee artifact attaches.
8. Confirm the UI shows:
   - final action decision
   - evidence status
   - analysts
   - bull/bear debate
   - research manager
   - risk perspectives
   - portfolio implication
9. Confirm no execution intent is created unless explicitly requested.

## Manual Prod Smoke

Run only after dev passes.

1. Open prod Mission Control.
2. Run one symbol from a small prod cohort.
3. Start committee review.
4. Confirm Codex/session status is visible.
5. Confirm final action decision appears.
6. Confirm repeated click does not create duplicate Codex sessions.
7. Wait for due settlement or run settle when due.
8. Confirm settlement reflection appears after settlement.

## Regression Checks

- Current quick Codex review still works.
- Existing `codex-review.md` artifacts still render.
- Existing V7 role output still renders.
- Timeline remains collapsible.
- Debug artifacts remain collapsed by default.
- Portfolio tab still reads Schwab cache.
- Prod and dev cache roots remain separate.
- No Alpaca, FRED, or legacy backtester dependency returns.

## Acceptance Criteria

- Committee review produces a traceable action decision.
- Evidence-ready no longer reads like automatic buy approval.
- Bearish sentiment can influence `WAIT`/`AVOID`.
- Owned symbols get portfolio-aware interpretation.
- Settlement reflections create reusable lessons.
- Duplicate session bug is covered by tests.
- No order-placement path exists in V8.
