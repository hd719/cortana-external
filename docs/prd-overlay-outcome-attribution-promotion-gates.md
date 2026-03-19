# PRD: Overlay Outcome Attribution and Promotion Gates

## Status
- Proposed
- Scope: `cortana-external` only
- Applies after merged "next-gen profit slice" overlays

## Summary
We now produce and surface overlay context in production-safe form:
- risk budget / aggression posture
- liquidity / execution-quality context
- liquidity-aware ranking bias
- alert/advisor annotations
- research logging fields

What we do not have yet is a disciplined system to answer:
1. Do these overlays improve outcomes?
2. Which overlays are safe to promote from research to operator-facing output?
3. Which overlays are safe to influence ranking?

This PRD adds a measured, gated promotion framework so overlays graduate based on evidence, not intuition.

## Problem Statement
Current state has two gaps:
- Attribution gap: overlay usefulness is not measured consistently by horizon and slice.
- Promotion gap: no explicit, enforceable threshold for moving an overlay from logged -> surfaced -> ranking modifier.

Without these, we risk:
- shipping noisy overlays that look smart but add no edge
- overfitting to anecdotal wins
- degrading operator trust and ranking quality

## Goals
- Build a read-only attribution pipeline for overlay usefulness.
- Define explicit promotion gates for each overlay stage.
- Keep Python strategy/regime logic as decision authority.
- Preserve current OpenClaw cron and Telegram notification workflow.
- Keep daytime path fast and deterministic.

## Non-Goals
- No direct auto-trading or order placement.
- No Kelly/Markowitz live sizing engine in production path.
- No replacement of CANSLIM/Dip Buyer decision logic.
- No heavy new daytime network dependencies.

## Success Criteria
- Each promoted overlay has a reproducible attribution report with:
  - horizon returns (`1d`, `5d`, `10d`)
  - hit rate
  - average forward return
  - calibration quality proxy
- Promotion decisions are auditable and reversible.
- Notify and cron reliability are unchanged or improved.

## Scope

### 1) Outcome Attribution
Track and report outcomes by overlay dimensions for settled candidates:
- `risk_budget_state`
- `aggression_posture`
- `execution_quality`
- `liquidity_tier`
- optional interaction slices (v1 capped to two-way slices with minimum sample counts)

Required outputs:
- per-horizon metrics: `1d`, `5d`, `10d`
- per-slice metrics: `n`, hit rate, mean return, median return, drawdown proxy
- calibration proxy: Brier-like scoring where applicable to discrete verdict buckets

### 2) Promotion Gates
Define three stages per overlay:
1. `logged` (research-only)
2. `surfaced` (operator-visible annotation)
3. `rank_modifier` (can influence prefilter/ranking weights)

Gate types:
- sample-size gate
- consistency gate (performance stable across rolling windows)
- downside gate (no unacceptable drawdown profile in promoted slice)
- reliability gate (no increase in cron/notify instability)

### 3) Governance and Rollback
- Promotion decisions must be file-backed and versioned.
- Any promoted overlay can be demoted automatically if metrics breach downgrade thresholds.
- Ranking modifier influence must be bounded and capped.

## Promotion Policy (Initial Thresholds)
Thresholds are defaults and should be revisited after first full cycle.

### Gate A: `logged` -> `surfaced`
- minimum settled samples per primary slice: `>= 40`
- minimum samples in each of the last two rolling windows: `>= 20`
- non-negative mean `5d` return in at least `2/3` recent windows
- no severe degradation in `1d` downside tail versus baseline
- baseline comparison rule: must beat `either` global baseline or matched baseline

### Gate B: `surfaced` -> `rank_modifier`
- minimum settled samples per primary slice: `>= 150`
- positive incremental lift versus baseline on:
  - hit rate OR mean `5d` return
  - and non-worse downside tail
- stability across both rolling windows: `8-week` and `12-week` (both must pass)
- baseline comparison rule: must beat `both` global baseline and matched baseline
- hard cap on modifier influence: `[-5%, +5%]`
- manual approval required before any promotion into `rank_modifier`

### Rank Modifier Allowlist (V1)
- `execution_quality`
- `liquidity_tier`
- all other overlays remain non-eligible for `rank_modifier` in v1

### Demotion and Cooldown
- auto-demote after `2` consecutive failed evaluation windows
- apply cooldown of `4` weeks before re-promotion is allowed

### Permanent Research-Only Candidates
Keep permanently research-only unless separately approved:
- unverified OSINT-derived signals
- fragile scrape-only event feeds
- any overlay requiring high-latency or unstable external calls in daytime path

## Architecture and Module-Level Plan

### Existing Files to Extend
- `/Users/hd/Developer/cortana-external/backtester/experimental_alpha.py`
  - continue storing overlay fields in candidate and settled records
  - add attribution report command/output for promotion evaluation
- `/Users/hd/Developer/cortana-external/backtester/outcomes.py`
  - add reusable horizon/slice aggregation helpers
  - add rolling-window stability calculations
- `/Users/hd/Developer/cortana-external/backtester/advisor.py`
  - read promotion status only for display/rank-annotation controls (no decision authority transfer)
- `/Users/hd/Developer/cortana-external/backtester/data/universe_selection.py`
  - apply bounded rank modifier only for overlays at `rank_modifier` stage
  - keep deterministic fallback and daytime no-heavy-refresh behavior

### New Files
- `/Users/hd/Developer/cortana-external/backtester/data/overlay_promotion.py`
  - promotion gate evaluator
  - downgrade trigger evaluator
- `/Users/hd/Developer/cortana-external/backtester/data/overlay_registry.json`
  - overlay definitions, current stage, bounds, and last evaluation metadata
- `/Users/hd/Developer/cortana-external/backtester/reports/overlay_attribution.py`
  - report generator for operator/research review (json + compact text)

### Artifact Contract
Produce read-only artifacts under existing local data paths:
- `overlay-attribution-latest.json`
- `overlay-promotion-state.json`

These are inputs to alert formatting/ranking bounds, not trade triggers.

## Data and Metrics Design

### Baseline Comparison
For each overlay, compare against:
- global baseline (all settled candidates)
- matched baseline (same strategy bucket when available)

### Required Metrics
- `n`
- hit rate
- mean forward return by horizon
- median forward return by horizon
- downside tail proxy (for example, p10 or worst-decile mean)
- calibration proxy for categorical outputs

### Interaction Slices (V1)
- Allow only two-way interactions with minimum sample guard.
- Example: `risk_budget_state x execution_quality`
- Do not enable high-dimensional interaction mining in v1.

## Testing Plan

### Unit Tests
- gate evaluator correctness for pass/fail/downgrade
- aggregation math for horizons and slices
- bounded rank modifier application and cap enforcement
- deterministic behavior when attribution artifacts are missing/stale

### Integration Tests
- end-to-end research output generation from synthetic settled records
- promotion state consumed by alert/ranking path without changing decision authority
- no regression in cron-safe daytime behavior

### Regression Tests
- ensure notify output remains valid if attribution artifacts are absent
- ensure ranking path falls back cleanly to current behavior if promotion state unavailable

## Rollout Plan

### Phase 1: Measurement Only
- enable attribution reports
- keep all overlays at `logged` or existing `surfaced` stage
- no ranking changes

### Phase 2: Controlled Surfacing Governance
- enforce Gate A for new overlay surfacing decisions
- require explicit promotion record update in `overlay_registry.json`

### Phase 3: Bounded Ranking Influence
- enable Gate B for selected overlays
- apply capped modifiers only
- monitor for drift and automatic demotion triggers
- require human approval for each transition into `rank_modifier`

## Compatibility and Safety
- Maintains current OpenClaw compute/notify workflow.
- Maintains Telegram delivery behavior.
- Keeps Python strategy/regime engine as final decision authority.
- Read-only overlays remain contextual and bounded.

## Deferred Work
- full portfolio optimization overlays in production
- dynamic online learning in live ranking
- direct execution logic
- unvalidated external OSINT auto-ingestion in daytime path
- unbounded interaction mining

## Risks and Mitigations
- Risk: false confidence from small samples
  - Mitigation: hard minimum sample gates and rolling-window checks
- Risk: overfitting through too many slices
  - Mitigation: restrict v1 to primary + two-way slices with minimum counts
- Risk: operational complexity
  - Mitigation: file-based registry, explicit stage model, deterministic fallback

## Open Questions
1. Should Gate A/Gate B sample thresholds be relaxed or tightened after the first 12-week evaluation cycle?
2. Should cooldown remain fixed at 4 weeks or become severity-based after repeated demotions?
3. Should additional overlays join the v1 rank-modifier allowlist after passing Gate B for multiple cycles?
