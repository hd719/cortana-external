# Technical Specification - Market Lab V8 Decision Committee

**Document Status:** Draft
**PRD:** [v8-decision-committee.md](../PRDs/v8-decision-committee.md)

## Development Overview

V8 adds a committee decision layer on top of the V7 research artifacts. It does not replace evidence gates, source quality, fundamentals, momentum, portfolio context, settlement, or V5 execution readiness.

The new layer should run after V7 evidence is available:

```text
V7 evidence artifacts
-> committee evidence gate
-> committee packet
-> analyst/debate/risk/final decision output
-> decision artifact
-> Mission Control rendering
-> settlement reflection after outcomes
```

The system remains Market Lab native. TradingAgents informs the shape: specialists, bull/bear debate, risk perspectives, final manager judgment, and post-outcome reflection.

## Product Requirement Traceability

| PRD ID | Product Intent | Tech Spec Concepts | Implementation Vertical |
|--------|----------------|--------------------|--------------------------|
| PRD-R1 | Start from hard evidence gates. | `CommitteeEvidenceGate`, blocker taxonomy | V1 - Decision Contract And Gates |
| PRD-R2 | Separate trade action from evidence validity. | `ActionDecision`, `CommitteeDecisionStatus` | V1 - Decision Contract And Gates |
| PRD-R3 | Add specialist analyst outputs. | `CommitteeRoleOutput`, role packet sections | V2 - Committee Packet And Analysts |
| PRD-R4 | Add bull/bear debate. | `DebateCase`, citation fields | V3 - Debate And Research Manager |
| PRD-R5 | Add manager synthesis. | `ResearchSynthesis` | V3 - Debate And Research Manager |
| PRD-R6 | Add risk committee perspectives. | `RiskPerspective`, risk vote summary | V4 - Risk Committee |
| PRD-R7 | Make decisions portfolio-aware. | `PortfolioFit`, ownership branch | V5 - Portfolio-Aware Final Decision |
| PRD-R8 | Persist final action decision. | `FinalCommitteeDecision` | V5 - Portfolio-Aware Final Decision |
| PRD-R9 | Reflect after settlement. | `SettlementReflection` | V6 - Settlement Reflection Memory |
| PRD-R10 | Feed lessons into future packets. | `DecisionMemoryContext` | V6 - Settlement Reflection Memory |
| PRD-R11 | Support quick/deep review modes. | `committee_mode`, token/depth policy | V2 - Committee Packet And Analysts |
| PRD-R12 | Render clearly. | Mission Control committee panels | V7 - Mission Control |
| PRD-R13 | Prevent duplicate sessions. | session lock and idempotency state | V8 - Idempotency And QA |
| PRD-R14 | Preserve no-order boundary. | V5 broker adapter separation | V8 - Idempotency And QA |

## Vertical Build Order

| Vertical | Consumes | Produces | Why It Comes Here |
|----------|----------|----------|-------------------|
| V1 - Decision Contract And Gates | Existing `review.json`, checks, V7 evidence | Action enum, committee gate result | Every later role needs the same vocabulary and gate status. |
| V2 - Committee Packet And Analysts | V7 artifacts, memory summary, portfolio summary | Compact packet and analyst role outputs | Analysts consume validated evidence. |
| V3 - Debate And Research Manager | Analyst role outputs | Bull case, bear case, manager synthesis | Debate needs analyst facts first. |
| V4 - Risk Committee | Debate plus portfolio/risk data | Aggressive, neutral, conservative risk outputs | Risk should respond to the actual debate. |
| V5 - Portfolio-Aware Final Decision | Analysts, debate, risk, portfolio | Final committee decision artifact | Final action depends on all prior pieces. |
| V6 - Settlement Reflection Memory | Final decisions and settlement rows | Lessons and memory context | Learning happens after outcomes. |
| V7 - Mission Control | V1-V6 artifacts | Operator UI | UI should render contracts rather than infer logic. |
| V8 - Idempotency And QA | All V8 flows | Verified no-duplicate sessions and no-order boundary | Final hardening validates the full path. |

## Storage Changes

Keep the existing cache model:

- Prod cache root: `<repo>/.cache/market_lab/prod`
- Dev cache root: `<repo>/.cache/market_lab/dev`
- Run artifacts: `<cache-root>/runs/<run_id>/`
- Run index: `<cache-root>/market_lab.sqlite`

Add run-scoped artifacts:

| Artifact | Producer | Consumer |
|----------|----------|----------|
| `committee-review-packet.md` | Committee packet builder | Codex/session bridge |
| `committee-decision.json` | Committee attach/parser flow | Mission Control, settlement reflection |
| `settlement-reflection.json` | Settlement reflection flow | Future packet builder, Mission Control |

Do not remove existing artifacts:

- `review.json`
- `codex-review-packet.md`
- `codex-review.md`
- `source-quality.json`
- `fundamentals.json`
- `momentum.json`
- `outcome-memory.json`
- `portfolio-context.json`

V8 may embed a short summary pointer inside `review.json`, but `committee-decision.json` should be the detailed source of truth for committee output.

## SQLite Changes

Prefer minimal schema extension.

Add or extend run metadata fields only if needed:

```text
committee_status: pending | running | attached | failed | skipped
committee_mode: quick | committee
committee_session_id: string | null
committee_started_at: timestamp | null
committee_attached_at: timestamp | null
committee_decision_path: string | null
```

If the current SQLite schema is not convenient to evolve, store this state in `committee-decision.json` and expose it through the run detail API first. Do not block V8 on a migration system.

## Python Models

Add or extend models in `market_lab/market_lab/models.py`.

```python
ActionDecision = Literal[
    "BUY_CANDIDATE",
    "WAIT",
    "AVOID",
    "HOLD",
    "SELL_REVIEW",
    "NEEDS_MORE_DATA",
]

class CommitteeEvidenceGate(Model):
    status: Literal["ready", "needs_more_context", "blocked"]
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    inputs: dict[str, str] = Field(default_factory=dict)

class CommitteeRoleOutput(Model):
    role: Literal[
        "price_momentum",
        "news_sentiment",
        "fundamentals",
        "portfolio",
        "risk",
    ]
    stance: Literal["bullish", "bearish", "neutral", "mixed"]
    confidence: float
    thesis: str
    decisive_evidence: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)

class DebateCase(Model):
    side: Literal["bull", "bear"]
    thesis: str
    strongest_evidence: list[str] = Field(default_factory=list)
    weakest_point: str | None = None
    confidence: float

class ResearchSynthesis(Model):
    winning_side: Literal["bull", "bear", "mixed", "inconclusive"]
    why: str
    decisive_evidence: list[str] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)

class RiskPerspective(Model):
    perspective: Literal["aggressive", "neutral", "conservative"]
    action_bias: ActionDecision
    rationale: str
    risk_flags: list[str] = Field(default_factory=list)

class PortfolioFit(Model):
    state: Literal["owned", "not_owned", "unavailable"]
    implication: Literal[
        "new_position_review",
        "add_to_existing_review",
        "hold_existing",
        "trim_or_sell_review",
        "avoid_more_exposure",
        "unknown",
    ]
    rationale: str

class FinalCommitteeDecision(Model):
    action: ActionDecision
    confidence: float
    time_horizon: Literal["intraday", "days", "weeks", "months", "unknown"]
    evidence_status: Literal["ready", "needs_more_context", "blocked"]
    portfolio_fit: PortfolioFit
    thesis: str
    invalidation_points: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    next_review_trigger: str | None = None
    execution_readiness_allowed: bool = False

class CommitteeDecisionArtifact(Model):
    schema_version: str
    run_id: str
    symbol: str
    created_at: str
    mode: Literal["quick", "committee"]
    evidence_gate: CommitteeEvidenceGate
    analysts: list[CommitteeRoleOutput]
    bull_case: DebateCase
    bear_case: DebateCase
    research_synthesis: ResearchSynthesis
    risk_perspectives: list[RiskPerspective]
    final_decision: FinalCommitteeDecision
```

## Committee Evidence Gate

Files:

- `market_lab/market_lab/checks.py`
- `market_lab/market_lab/verdict.py`
- `market_lab/market_lab/runner.py`
- `market_lab/market_lab/models.py`

Inputs:

- price freshness and source
- SPY reference freshness and source
- source-quality status
- fundamentals status
- momentum status
- portfolio context status
- existing deterministic blockers
- environment: prod/dev

Rules:

- Hard blockers prevent `BUY_CANDIDATE`, `HOLD`, or `SELL_REVIEW` actions.
- Missing optional context may allow `WAIT` or `NEEDS_MORE_DATA`.
- Evidence-ready status does not imply buy candidate.
- Portfolio unavailable must be visible to the final decision.

## Committee Packet Builder

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/token_budget.py`
- `market_lab/market_lab/memory.py`
- `market_lab/tests/test_codex_review.py`

Packet sections:

```text
run identity
evidence gate result
price and momentum
source-quality summary
fundamentals snapshot
portfolio context summary
prior outcome memory
same-symbol lessons
cross-symbol lessons
committee instructions
strict JSON output schema
```

Rules:

- Do not embed full raw `review.json`.
- Do not embed full Schwab portfolio payload.
- Cap raw source item excerpts.
- Include links/timestamps for cited source items.
- Include current prod/dev environment.
- Include existing settlement memory only as compact stats and lessons.

## Committee Session Idempotency

Files:

- `market_lab/market_lab/codex_review.py`
- `apps/mission-control/app/api/market-lab/runs/[runId]/codex-review/route.ts`
- `apps/mission-control/lib/market-lab.ts`

Behavior:

- If a committee review is `running`, return the existing session state.
- If a committee review is `attached`, return the existing artifact path.
- If a previous attempt failed, allow retry.
- Add an explicit force path only if the operator confirms it.
- Persist the session ID as soon as the session request succeeds.

## API Changes

Prefer extending the existing Codex review endpoint instead of adding a new route.

```http
POST /api/market-lab/runs/:runId/codex-review
```

Request:

```json
{
  "mode": "committee",
  "force": false
}
```

Response:

```json
{
  "status": "running",
  "mode": "committee",
  "sessionId": "session-id",
  "artifactPath": null,
  "message": "Committee review is running."
}
```

The existing quick review mode should remain valid for current UI flows.

## Settlement Reflection

Files:

- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/memory.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/tests/test_memory.py`
- `market_lab/tests/test_settlement.py`

When a settlement window closes, write or update:

```text
<cache-root>/runs/<run_id>/settlement-reflection.json
```

Reflection shape:

```python
class SettlementReflection(Model):
    run_id: str
    symbol: str
    window: Literal["1D", "5D", "20D", "60D"]
    action: ActionDecision
    symbol_return_pct: float
    spy_return_pct: float
    alpha_pct: float
    directional_useful: bool
    lesson: str
```

The lesson should be compact enough to re-enter future packets.

## Mission Control

Files:

- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`
- `apps/mission-control/lib/market-lab.ts`

UI panels:

- final action decision
- evidence gate result
- committee status banner
- analyst outputs
- bull/bear debate
- research manager synthesis
- risk perspectives
- portfolio implication
- settlement reflection lessons

Collapse by default:

- timeline
- debug artifacts
- long role details
- raw source samples

Always visible:

- action decision
- confidence
- evidence status
- next review trigger
- whether Codex/committee review is attached or running

## V5 Boundary

No V8 module may place orders.

Allowed:

- produce final action decision
- produce execution-readiness eligibility flag
- create or update an execution intent candidate only through the V5 contract
- call `BrokerAdapter.validateIntent(intent)`
- call `BrokerAdapter.previewOrder(intent)`

Not allowed:

- direct broker order placement
- direct Schwab order placement
- strategy/review modules calling broker APIs

## Risks

| Risk | Mitigation |
|------|------------|
| Committee output becomes persuasive but wrong | Preserve evidence gates, debate, risk perspectives, and settlement memory. |
| Token bloat | Use compact packet, lesson caps, source caps, and quick/committee modes. |
| Duplicate Codex sessions | Persist session lock/state immediately and make review endpoint idempotent. |
| Action language feels like execution | Keep V5 execution-readiness boundary explicit and visible. |
| Portfolio context unavailable | Lower confidence and show portfolio status in final decision. |
| Early settlement data overfits | Use sample thresholds for aggregate learning. |
