# Backtester Planning Index

This directory turns the roadmap into execution-ready planning artifacts.

Before adding new planning docs, read the repo-wide placement guide:
- [Documentation authoring guide](/Users/hd/Developer/cortana-external/docs/source/architecture/documentation-authoring-guide.md)

Use the documents in this order:

1. [Roadmap](/Users/hd/Developer/cortana-external/backtester/docs/source/roadmap/roadmap.md)
2. [Git Workflow Plan](/Users/hd/Developer/cortana-external/backtester/planning/docs/git-workflow.md)
3. PRD for the workstream you are implementing
4. Matching Tech Spec
5. Matching Implementation Plan
6. Matching QA Plan

The workstreams are deliberately grouped so another LLM or engineer can execute them without reconstructing the full repo history.

## Workstream Map

### W1. Foundations And Runtime Reliability

- PRD: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/01-foundations-and-runtime-reliability.md)
- Tech Spec: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/01-foundations-and-runtime-reliability.md)
- Implementation Plan: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/01-foundations-and-runtime-reliability.md)

Covers:
- Phase 0
- Phase 1
- machine contracts
- failure taxonomy
- health semantics
- pre-open readiness gate

### W2. Prediction Loop, Measurement, And Decision Math

- PRD: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/02-prediction-loop-and-measurement.md)
- Tech Spec: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/02-prediction-loop-and-measurement.md)
- Implementation Plan: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/02-prediction-loop-and-measurement.md)

Covers:
- Phase 2
- prediction loop
- calibration
- decision math
- opportunity cost
- veto effectiveness

### W3. Trade Lifecycle, Execution, Risk, And Portfolio

- PRD: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/03-trade-lifecycle-execution-risk-and-portfolio.md)
- Tech Spec: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/03-trade-lifecycle-execution-risk-and-portfolio.md)
- Implementation Plan: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/03-trade-lifecycle-execution-risk-and-portfolio.md)

Covers:
- Phase 3
- Phase 6
- Phase 7
- entry plans
- execution policy
- paper portfolio
- sizing
- portfolio simulation

### W4. Decision Brain, Narrative Discovery, And Research Plane

- PRD: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/04-decision-brain-narrative-and-research-plane.md)
- Tech Spec: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/04-decision-brain-narrative-and-research-plane.md)
- Implementation Plan: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/04-decision-brain-narrative-and-research-plane.md)

Covers:
- Phase 4
- Phase 5
- decision brain layer
- narrative overlays
- intraday breadth evolution
- asynchronous research plane

### W5. Governance, Validation, And Model Promotion

- PRD: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/05-governance-validation-and-model-promotion.md)
- Tech Spec: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/05-governance-validation-and-model-promotion.md)
- Implementation Plan: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/05-governance-validation-and-model-promotion.md)

Covers:
- Phase 8
- walk-forward validation
- point-in-time integrity
- leakage checks
- benchmark ladder
- promotion and retirement rules

### W6. Unified Operator Surfaces And Ops Highway

- PRD: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/06-operator-surfaces-and-ops-highway.md)
- Tech Spec: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/06-operator-surfaces-and-ops-highway.md)
- Implementation Plan: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/06-operator-surfaces-and-ops-highway.md)

Covers:
- Phase 9
- Ops Highway
- unified decision contracts
- operational runbooks
- deployment/runtime readiness

### W7. Trading Ops Live State And Operator Truth

- PRD: [07-trading-ops-live-state-and-operator-truth.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/07-trading-ops-live-state-and-operator-truth.md)
- Tech Spec: [07-trading-ops-live-state-and-operator-truth.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/07-trading-ops-live-state-and-operator-truth.md)
- Implementation Plan: [07-trading-ops-live-state-and-operator-truth.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/07-trading-ops-live-state-and-operator-truth.md)

Covers:
- Mission Control Trading Ops as a trustworthy operator surface
- DB-backed latest trading run state
- live runtime health as a separate current-state source
- explicit fallback and stale-data semantics
- cross-repo current-state contract between `cortana` and `cortana-external`

### W8. Backtester V2 Signal Intelligence And Operator Trust

- PRD: [08-backtester-v2-signal-intelligence-and-operator-trust.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/08-backtester-v2-signal-intelligence-and-operator-trust.md)
- Tech Spec: [08-backtester-v2-signal-intelligence-and-operator-trust.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/08-backtester-v2-signal-intelligence-and-operator-trust.md)
- Implementation Plan: [08-backtester-v2-signal-intelligence-and-operator-trust.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/08-backtester-v2-signal-intelligence-and-operator-trust.md)
- QA Plan: [08-backtester-v2-signal-intelligence-and-operator-trust.md](/Users/hd/Developer/cortana-external/backtester/planning/QA/08-backtester-v2-signal-intelligence-and-operator-trust.md)

Covers:
- signal-quality-first roadmap
- canonical 1-5 day horizon
- opportunity-score contract
- benchmarked challenger family
- Mission Control trust surfaces

### W9. Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy

- PRD: [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md)
- Tech Spec: [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md)
- Implementation Plan: [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md)
- QA Plan: [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](/Users/hd/Developer/cortana-external/backtester/planning/QA/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md)

Covers:
- two-stage capital competition
- trust-tier driven authority
- canonical risk-budget stack
- supervised-live gating
- Mission Control posture and autonomy surface

### W10. Backtester V4 Unified Trading Control Loop And Scaled Compounding

- PRD: [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md)
- Tech Spec: [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md)
- Implementation Plan: [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md)
- QA Plan: [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](/Users/hd/Developer/cortana-external/backtester/planning/QA/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md)

Covers:
- desired-state vs actual-state control loop
- release-unit discipline and rollback
- drift and runtime-aware intervention
- Mission Control as control tower
- scaled compounding with explicit operator control

### W11. Backtester V4 Buy Readiness And Control-Loop Hardening

- PRD: [11-backtester-v4-buy-readiness-and-control-loop-hardening.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/11-backtester-v4-buy-readiness-and-control-loop-hardening.md)
- Tech Spec: [11-backtester-v4-buy-readiness-and-control-loop-hardening.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/11-backtester-v4-buy-readiness-and-control-loop-hardening.md)
- Implementation Plan: [11-backtester-v4-buy-readiness-and-control-loop-hardening.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/11-backtester-v4-buy-readiness-and-control-loop-hardening.md)
- QA Plan: [11-backtester-v4-buy-readiness-and-control-loop-hardening.md](/Users/hd/Developer/cortana-external/backtester/planning/QA/11-backtester-v4-buy-readiness-and-control-loop-hardening.md)

Covers:
- hard BUY-readiness gates
- raw action vs final action provenance
- calibration source-of-truth cleanup
- scheduled V4 control-loop refresh
- Mission Control readiness visibility

### W12. Backtester V5 Evidence-Gated Operator Evaluation

- PRD: [12-backtester-v5-evidence-gated-operator-evaluation.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/12-backtester-v5-evidence-gated-operator-evaluation.md)
- Precursor Handoff: [w12-precursor-handoff.md](/Users/hd/Developer/cortana-external/backtester/planning/docs/w12-precursor-handoff.md)

Status: blocked until W11 produces sufficient live or replay evidence.

Covers:
- activation gate for post-hardening feature work
- LLM-readable evidence comparison packet
- readiness criteria before W12 implementation starts
- operator trust summaries with evidence and counterevidence

### W13. Mission Control Advisor Cockpit And Telegram Actions

- PRD: [13-mission-control-advisor-cockpit-and-telegram-actions.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/13-mission-control-advisor-cockpit-and-telegram-actions.md)

Status: future work after W12 activation approval.

Covers:
- Mission Control as the primary advisor cockpit
- Telegram buy/sell/action alerts
- multi-horizon recommendations
- counterarguments for actionable signals
- learning from manual operator decisions

### W14. Supervised Real Execution Readiness

- PRD: [14-supervised-real-execution-readiness.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/14-supervised-real-execution-readiness.md)

Status: future work after W13 advisor cockpit proves useful.

Covers:
- advisor to supervised execution path
- explicit no-paper-trading constraint
- execution policy contracts
- approval modes and kill switch
- broker boundary and execution audit trail


### Market Lab V0 Forward-Looking Trust Reviews

- PRD: [market-lab-v0-forward-looking-trust-reviews.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/market-lab-v0-forward-looking-trust-reviews.md)
- Tech Spec: [market-lab-v0-forward-looking-trust-reviews.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/market-lab-v0-forward-looking-trust-reviews.md)
- Implementation Plan: [market-lab-v0-forward-looking-trust-reviews.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/market-lab-v0-forward-looking-trust-reviews.md)
- QA Plan: [market-lab-v0-forward-looking-trust-reviews.md](/Users/hd/Developer/cortana-external/backtester/planning/QA/market-lab-v0-forward-looking-trust-reviews.md)

Status: new application planning draft for review. Not a numbered backtester workstream.

Covers:
- new isolated Market Lab product direction
- one-symbol forward-looking reviews from Mission Control
- TradingAgents as a second-opinion research lane
- Trust Verdict artifacts with facts separated from interpretation
- passive 1D/5D/20D outcome tracking with raw P/L and alpha vs SPY
- production-shaped Python that remains explainable and debuggable

## Recommended Order

Execution order:

1. W1 Foundations And Runtime Reliability
2. W2 Prediction Loop, Measurement, And Decision Math
3. W3 Trade Lifecycle, Execution, Risk, And Portfolio
4. W4 Decision Brain, Narrative Discovery, And Research Plane
5. W5 Governance, Validation, And Model Promotion
6. W6 Unified Operator Surfaces And Ops Highway
7. W7 Trading Ops Live State And Operator Truth
8. W8 Backtester V2 Signal Intelligence And Operator Trust
9. W9 Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy
10. W10 Backtester V4 Unified Trading Control Loop And Scaled Compounding
11. W11 Backtester V4 Buy Readiness And Control-Loop Hardening
12. W12 Backtester V5 Evidence-Gated Operator Evaluation
13. W13 Mission Control Advisor Cockpit And Telegram Actions
14. W14 Supervised Real Execution Readiness

This order is deliberate for the numbered backtester workstreams:
- W1 makes the system truthful and stable
- W2 creates the measurement loop
- W3 turns signals into lifecycle decisions
- W4 makes the system smarter without blocking the hot path
- W5 hardens the science and promotion rules
- W6 unifies the operator experience and long-run operations
- W7 turns Trading Ops into a trustworthy current-state surface using explicit source ownership
- W8 strengthens the signal layer before broader automation
- W9 turns trusted signals into governed capital competition
- W10 unifies posture, release, drift, and intervention into one trading control loop
- W11 hardens final BUY semantics so advisory labels require current evidence and current control-loop truth
- W12 stays blocked until W11 evidence proves the system is ready for post-hardening feature work
- W13 turns the proven evidence into a usable advisor cockpit and alerting product
- W14 defines the guarded path from advisor recommendations to supervised real execution

Market Lab V0 is intentionally listed separately above because it is a new application direction, not W15 or a continuation of the old backtester sequence.

## Authoring Rules

For every workstream:
- PRD explains why it matters and what success looks like
- Tech Spec explains how it will be built
- Implementation Plan breaks the work into verticals another LLM can execute
- QA Plan proves the behavior, rollout safety, and operator truth before the workstream should be considered shippable

Start from these templates:
- [PRD template](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/template.md)
- [Tech Spec template](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/template.md)
- [Implementation template](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/template.md)
- [QA template](/Users/hd/Developer/cortana-external/backtester/planning/QA/template.md)

All four documents should stay aligned on:
- scope
- dependencies
- artifacts
- testing
- rollout order
