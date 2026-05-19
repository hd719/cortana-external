# Market Lab V8 Decision Committee PRD

**Document Status:** Draft
**Owner:** Trading systems
**Last Updated:** 2026-05-19
**Depends On:** Market Lab V2-V7

## Problem / Opportunity

Market Lab now has live Schwab prices, source-quality filtering, fundamentals, momentum versus SPY, portfolio context, Codex role output, settlement tracking, and prod/dev data separation.

The next gap is decision quality. V7 explains the evidence better, but Market Lab still mostly answers:

```text
Is this review evidence-ready, and what did the analyst roles say?
```

V8 should answer the sharper trading question:

```text
Given the evidence, portfolio context, and prior outcomes, is this a buy candidate, a wait, an avoid, a hold, or a sell review?
```

TradingAgents is useful as ideology: specialist analysts, bull/bear debate, risk committee, portfolio-manager judgment, and reflection after outcomes. Market Lab should borrow that shape without cloning TradingAgents, reintroducing the old backtester, or bypassing the Schwab/evidence/settlement guardrails already built.

## Product Goal

Create a Market Lab Decision Committee that turns a one-symbol review into a traceable investment-committee decision.

V8 should make Market Lab feel less like "Codex reviewed a packet" and more like:

```text
Evidence gates
-> specialist analysts
-> bull/bear debate
-> research manager synthesis
-> risk committee
-> portfolio-aware final decision
-> settlement reflection after outcomes
```

The goal is not to mimic TradingAgents. The goal is accurate, auditable guidance on when a stock deserves trade consideration.

## Goals

- Keep deterministic evidence gates as the first safety boundary.
- Let Codex/agents reason deeply when the evidence is worth review; agent usage is not the bottleneck.
- Separate evidence validity from trade direction.
- Add explicit action decisions:
  - `BUY_CANDIDATE`
  - `WAIT`
  - `AVOID`
  - `HOLD`
  - `SELL_REVIEW`
  - `NEEDS_MORE_DATA`
- Add a bull/bear debate layer so persuasive one-sided reasoning is challenged.
- Add a research manager synthesis that explains which side won and why.
- Add aggressive, neutral, and conservative risk perspectives.
- Make portfolio context change the decision when the symbol is already owned.
- Turn settlements into lessons that future reviews can read.
- Keep every decision auditable in Mission Control.

## Non-Goals

- No autonomous order placement.
- No paper-trading mode.
- No reintroduction of Alpaca, FRED, or legacy backtester paths.
- No direct dependency on TradingAgents runtime for V8.
- No paid data providers without explicit approval.
- No BUY/SELL alerting to Telegram until the decision contract is proven.
- No broker `placeOrder` implementation.

## Requirements

Use these IDs to trace the PRD into the Tech Spec and Implementation Plan.

| ID | Requirement | Description |
|----|-------------|-------------|
| PRD-R1 | Evidence Gate | Every committee review starts from hard gates: price freshness, SPY reference, artifact validity, source status, and portfolio context status. |
| PRD-R2 | Decision Vocabulary | Add action decisions separate from evidence status: `BUY_CANDIDATE`, `WAIT`, `AVOID`, `HOLD`, `SELL_REVIEW`, `NEEDS_MORE_DATA`. |
| PRD-R3 | Specialist Analysts | Produce explicit Price/Momentum, News/Sentiment, Fundamentals, Portfolio, and Risk analyst outputs. |
| PRD-R4 | Bull/Bear Debate | Produce a bullish case and bearish case that argue from the same evidence. |
| PRD-R5 | Research Manager | Produce a synthesis that says which side won, why, and what evidence was decisive. |
| PRD-R6 | Risk Committee | Produce aggressive, neutral, and conservative risk perspectives before the final decision. |
| PRD-R7 | Portfolio-Aware Decision | If the symbol is already owned, the final decision must distinguish add, hold, trim-review, or avoid-more-exposure reasoning. |
| PRD-R8 | Final Decision Contract | Persist one final decision with action, confidence, time horizon, invalidation points, missing evidence, and next review trigger. |
| PRD-R9 | Settlement Reflection | After 1D/5D/20D/60D settlement, generate a compact lesson and make it available to future reviews. |
| PRD-R10 | Decision Memory | Future reviews should include same-symbol lessons and recent cross-symbol lessons without bloating the Codex packet. |
| PRD-R11 | Depth Modes | Support quick review and committee review modes so deep reasoning is intentional and visible. |
| PRD-R12 | Mission Control Clarity | Show committee output in a readable way without burying the operator in raw artifacts. |
| PRD-R13 | Idempotent Agent Runs | A run can have only one active committee review session per mode unless explicitly forced. |
| PRD-R14 | No Execution Bypass | No action decision may call broker APIs directly; V5 execution readiness remains the only execution boundary. |

## Requirement Traceability

| PRD Requirement | Tech Spec Concept | Implementation Vertical |
|-----------------|-------------------|--------------------------|
| PRD-R1 Evidence Gate | `CommitteeEvidenceGate`, gate inputs, blocker taxonomy | V1 - Decision Contract And Gates |
| PRD-R2 Decision Vocabulary | `ActionDecision`, action-vs-evidence status separation | V1 - Decision Contract And Gates |
| PRD-R3 Specialist Analysts | `CommitteeRoleOutput`, role packet sections | V2 - Committee Packet And Analysts |
| PRD-R4 Bull/Bear Debate | `DebateCase`, debate evidence citations | V3 - Debate And Research Manager |
| PRD-R5 Research Manager | `ResearchSynthesis`, decisive evidence | V3 - Debate And Research Manager |
| PRD-R6 Risk Committee | `RiskPerspective`, risk vote summary | V4 - Risk Committee |
| PRD-R7 Portfolio-Aware Decision | `PortfolioFit`, owned/not-owned branch | V5 - Portfolio-Aware Final Decision |
| PRD-R8 Final Decision Contract | `FinalCommitteeDecision`, invalidation and next trigger | V5 - Portfolio-Aware Final Decision |
| PRD-R9 Settlement Reflection | `SettlementReflection`, reflection writer | V6 - Settlement Reflection Memory |
| PRD-R10 Decision Memory | `DecisionMemoryContext`, compact lesson selection | V6 - Settlement Reflection Memory |
| PRD-R11 Depth Modes | `committee_mode`, token/depth policy | V2 - Committee Packet And Analysts |
| PRD-R12 Mission Control Clarity | Committee UI panels, collapsed raw artifacts | V7 - Mission Control |
| PRD-R13 Idempotent Agent Runs | session lock, session state, force flag | V8 - Idempotency And QA |
| PRD-R14 No Execution Bypass | V5 broker boundary check | V8 - Idempotency And QA |

## Product Semantics

V8 must keep these concepts separate:

| Concept | Meaning |
|---------|---------|
| Evidence status | Whether the review has enough valid data to reason from. Existing examples: evidence ready, needs more context, blocked. |
| Committee decision | What the committee thinks Hamel should do with the idea. Examples: buy candidate, wait, avoid, hold, sell review. |
| Execution readiness | Whether an approved intent can be validated or previewed by the broker adapter. This remains V5 and does not place orders. |

Example:

```text
Evidence status: evidence ready
Committee decision: WAIT
Reason: price/momentum is strong, but sentiment is bearish and earnings risk is near.
Execution readiness: not requested
```

## Committee Flow

V8 should support this flow:

```text
Evidence gate
-> Price/Momentum analyst
-> News/Sentiment analyst
-> Fundamentals analyst
-> Portfolio analyst
-> Bull case
-> Bear case
-> Research manager
-> Aggressive risk
-> Neutral risk
-> Conservative risk
-> Final judge
-> Settlement reflection later
```

This can run as one Codex session with a strict structured output contract, or as multiple agent calls later if the implementation needs stronger isolation. V8 docs should not require LangGraph. The important contract is the persisted committee artifact.

## Decision Output

The final decision should include:

- action
- confidence
- time horizon
- evidence status
- bullish thesis
- bearish thesis
- decisive evidence
- invalidation points
- missing evidence
- next review trigger
- portfolio implication
- whether this can become an execution-readiness candidate

## Portfolio Rules

The same symbol means different things depending on ownership:

| Portfolio State | Decision Meaning |
|-----------------|------------------|
| Not owned | `BUY_CANDIDATE`, `WAIT`, `AVOID`, `NEEDS_MORE_DATA` |
| Owned | `HOLD`, `ADD_REVIEW`, `SELL_REVIEW`, `WAIT`, `NEEDS_MORE_DATA` |
| Portfolio unavailable | Decision must say portfolio context was unavailable and lower confidence if ownership matters. |

`ADD_REVIEW` can be represented as `BUY_CANDIDATE` with `portfolio_implication: add_to_existing_position` if the implementation should keep the action enum smaller.

## Settlement Reflection

Settlement is how the committee learns.

After each settlement window closes, Market Lab should record:

- original action decision
- original confidence
- original role outputs
- symbol return
- SPY return
- alpha versus SPY
- whether the decision was directionally useful
- a 2-4 sentence lesson

Future packets should include:

- up to 5 same-symbol lessons
- up to 3 recent cross-symbol lessons
- aggregate win/alpha stats only when sample thresholds are met

## Success Criteria

- A prod review can produce a committee decision, not just evidence-ready status.
- A bearish sentiment run can still be evidence-ready but receive `WAIT` or `AVOID` if the committee finds risk unacceptable.
- Owned symbols show portfolio-aware reasoning.
- Re-clicking committee review does not spawn duplicate sessions.
- Mission Control shows the final decision, bull/bear debate, research manager, risk perspectives, and settlement lesson.
- Settled outcomes create compact lessons for future runs.
- No V8 code path places orders or calls broker execution APIs directly.

## Open Questions Answered

| Question | Decision |
|----------|----------|
| Should V8 copy TradingAgents directly? | No. Use the ideology, keep Market Lab native. |
| Are agents/Codex calls a bottleneck? | No. Accuracy and auditability matter more than minimizing agent usage for high-quality prod reviews. |
| Should V8 produce buy/sell language? | It can produce action decisions, but execution remains gated by V5. |
| Should Codex be automatic? | Committee review should be automatic for explicit committee/deep runs and idempotent for manual "Ask Codex" flows. |
| Should settlement lessons affect future decisions immediately? | They can be shown immediately, but aggregate confidence changes should wait for sample thresholds. |
