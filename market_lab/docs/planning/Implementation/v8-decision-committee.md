# Implementation Plan - Market Lab V8 Decision Committee

**Document Status:** Draft
**PRD:** [v8-decision-committee.md](../PRDs/v8-decision-committee.md)
**Tech Spec:** [v8-decision-committee.md](../TechSpecs/v8-decision-committee.md)

## How To Trace This Plan

Start with the PRD requirement, map it to the Tech Spec contract, then build the vertical here.

Example:

```text
PRD-R4 Bull/Bear Debate
-> Tech Spec: DebateCase
-> Implementation: V3 - Debate And Research Manager
-> UI: V7 - Mission Control
-> QA: V8 - Idempotency And QA
```

## Dependency Map

| Vertical | Delivers PRD | Implements Tech Spec Concepts | Dependencies | Outcome |
|----------|--------------|-------------------------------|--------------|---------|
| V1 - Decision Contract And Gates | PRD-R1, PRD-R2, PRD-R14 | `ActionDecision`, `CommitteeEvidenceGate` | Existing checks/verdict artifacts | Shared vocabulary and safety gate. |
| V2 - Committee Packet And Analysts | PRD-R3, PRD-R11 | `CommitteeRoleOutput`, committee packet | V1, V7 artifacts | Price/news/fundamentals/portfolio/risk analysts have compact evidence. |
| V3 - Debate And Research Manager | PRD-R4, PRD-R5 | `DebateCase`, `ResearchSynthesis` | V2 | Bull and bear cases plus manager synthesis. |
| V4 - Risk Committee | PRD-R6 | `RiskPerspective` | V3 | Aggressive/neutral/conservative risk views. |
| V5 - Portfolio-Aware Final Decision | PRD-R7, PRD-R8 | `PortfolioFit`, `FinalCommitteeDecision`, `CommitteeDecisionArtifact` | V1-V4 | Persisted action decision with rationale and next trigger. |
| V6 - Settlement Reflection Memory | PRD-R9, PRD-R10 | `SettlementReflection`, `DecisionMemoryContext` | Existing settlement rows, V5 | Future reviews learn from settled outcomes. |
| V7 - Mission Control | PRD-R12 | Committee rendering and status banners | V1-V6 | Operator can understand the committee decision. |
| V8 - Idempotency And QA | PRD-R13, PRD-R14 | session lock, no-order assertions, QA fixtures | V1-V7 | The flow is testable and safe. |

## Vertical 1 - Decision Contract And Gates

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/checks.py`
- `market_lab/market_lab/verdict.py`
- `market_lab/market_lab/runner.py`
- `market_lab/tests/test_verdict.py`
- `market_lab/tests/test_runner.py`

Tasks:

- Add `ActionDecision` vocabulary.
- Add `CommitteeEvidenceGate`.
- Map existing hard blockers into committee blockers.
- Keep evidence status separate from action decision.
- Ensure blocked evidence cannot produce `BUY_CANDIDATE`, `HOLD`, or `SELL_REVIEW`.
- Add tests for ready, needs-more-context, and blocked gate states.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_verdict.py market_lab/tests/test_runner.py
```

## Vertical 2 - Committee Packet And Analysts

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/token_budget.py`
- `market_lab/market_lab/memory.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_codex_review.py`
- `market_lab/tests/test_memory.py`

Tasks:

- Add committee packet mode.
- Keep current quick packet mode intact.
- Include compact summaries for:
  - evidence gate
  - price/momentum
  - news/source quality
  - fundamentals
  - portfolio context
  - settlement/outcome memory
- Add role instructions for:
  - Price/Momentum analyst
  - News/Sentiment analyst
  - Fundamentals analyst
  - Portfolio analyst
  - Risk analyst
- Add structured output schema for `CommitteeRoleOutput`.
- Cap sources, lessons, and portfolio detail.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_codex_review.py market_lab/tests/test_memory.py
```

## Vertical 3 - Debate And Research Manager

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Add `DebateCase` output schema.
- Require one bull case and one bear case.
- Require each side to cite evidence already present in the packet.
- Add `ResearchSynthesis`.
- Require synthesis to say:
  - which side won
  - what evidence was decisive
  - what remains unresolved
- Add parser validation tests for complete and incomplete debate outputs.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_codex_review.py
```

## Vertical 4 - Risk Committee

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Add `RiskPerspective`.
- Require aggressive, neutral, and conservative risk outputs.
- Require each perspective to produce an action bias.
- Ensure the final judge can cite risk perspectives.
- Add tests that missing risk perspectives fail schema validation.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_codex_review.py
```

## Vertical 5 - Portfolio-Aware Final Decision

Files:

- `market_lab/market_lab/portfolio_context.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_portfolio_context.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Add `PortfolioFit`.
- Add `FinalCommitteeDecision`.
- Add `CommitteeDecisionArtifact`.
- Make owned symbols branch differently from non-owned symbols.
- Include quantity/current price/current value when available.
- If portfolio context is unavailable, mark the decision and lower confidence rather than pretending the position is unknown.
- Add execution-readiness eligibility flag, but do not create an execution intent automatically.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_portfolio_context.py market_lab/tests/test_codex_review.py
```

## Vertical 6 - Settlement Reflection Memory

Files:

- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/memory.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/tests/test_settlement.py`
- `market_lab/tests/test_memory.py`

Tasks:

- Add `SettlementReflection`.
- Generate or attach compact lessons after settlement.
- Store lessons in the run folder as `settlement-reflection.json`.
- Expose same-symbol and cross-symbol lessons to future committee packets.
- Limit injected lessons to avoid token bloat.
- Keep aggregate scoring sample-thresholded.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_settlement.py market_lab/tests/test_memory.py
```

## Vertical 7 - Mission Control

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`
- `apps/mission-control/app/api/market-lab/runs/[runId]/codex-review/route.ts`
- `apps/mission-control/app/api/market-lab/runs/[runId]/codex-review/route.test.ts`

Tasks:

- Add committee decision banner.
- Show action decision separately from evidence status.
- Show committee review status:
  - not started
  - running
  - attached
  - failed
- Show analyst role summaries.
- Show bull/bear debate.
- Show research manager synthesis.
- Show risk perspectives.
- Show portfolio implication.
- Show settlement reflection lessons when present.
- Keep timeline/debug/raw details collapsed by default.

Verification:

```bash
cd apps/mission-control && pnpm exec vitest run app/market-lab/market-lab-client.test.tsx app/api/market-lab/runs/[runId]/codex-review/route.test.ts lib/market-lab.test.ts
```

## Vertical 8 - Idempotency And QA

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/broker_adapter.py`
- `market_lab/tests/test_codex_review.py`
- `market_lab/tests/test_broker_adapter.py`
- `apps/mission-control/app/api/market-lab/runs/[runId]/codex-review/route.test.ts`

Tasks:

- Prevent duplicate committee sessions for the same run and mode.
- Return existing running/attached state on repeat clicks.
- Allow explicit retry after failure.
- Assert V8 does not call broker order placement.
- Keep `BrokerAdapter.validateIntent` and `BrokerAdapter.previewOrder` as the only broker-facing V5 hooks.
- Add fixture run that simulates a complete committee decision.

Verification:

```bash
uv run --project market_lab pytest market_lab/tests/test_codex_review.py market_lab/tests/test_broker_adapter.py
cd apps/mission-control && pnpm exec vitest run app/api/market-lab/runs/[runId]/codex-review/route.test.ts
```

## Full QA Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm exec vitest run app/market-lab/market-lab-client.test.tsx app/api/market-lab/runs/[runId]/codex-review/route.test.ts lib/market-lab.test.ts
cd apps/mission-control && pnpm build
```

## Live Smoke

Run in dev first:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --json
uv run --project market_lab python -m market_lab.cli codex-packet <run_id> --mode committee --json
```

Expected:

- run creates V7 evidence artifacts
- committee packet is compact
- Codex/session bridge attaches one committee decision
- repeated clicks do not spawn duplicate sessions
- Mission Control shows final action decision and committee sections
- no order placement happens

Then repeat one prod run after dev passes.

## Scope Boundary

V8 is allowed to create better decisions. It is not allowed to execute trades.

If a decision looks trade-worthy, the next step remains V5 execution readiness:

```text
committee decision
-> optional execution intent
-> approval
-> BrokerAdapter.validateIntent
-> BrokerAdapter.previewOrder
-> final human confirmation
```
