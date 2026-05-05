# Product Requirements Document (PRD) - Mission Control Trading Ops Read Model

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control Trading Ops read model |

---

## Problem / Opportunity

Mission Control's Trading Ops surface is operationally important but architecturally dense. Today, completed-run truth, artifact fallback, live market-data state, Polymarket status, freshness policy, and operator-facing wording are spread across a small set of very large modules and a large dashboard component.

The current implementation works and is well tested, but it is hard to change safely because one operator concept often requires reading multiple files and many helper functions before the behavior is clear. The opportunity is to deepen the Trading Ops boundary into a smaller public interface that hides source selection, fallback rules, freshness evaluation, and display-state shaping behind a single read-model contract.

This is a future refactor planning package. It does not request immediate behavior changes.

---

## Insights

- `apps/mission-control/lib/trading-ops.ts` and `apps/mission-control/components/trading-ops-dashboard.tsx` are both over 2,000 lines, which is a strong signal that product behavior, data loading, fallback logic, and presentation decisions are too interleaved.
- The existing test suite already captures many important scenarios, including DB-backed latest-run truth, file fallback, stale artifacts, streamer degradation, and Polymarket warmup states. A refactor can preserve behavior by moving those assertions to a deeper boundary rather than rewriting the surface.
- Trading Ops is a source-of-truth UI. Silent fallback, stale live data, or mismatched DB/artifact state can mislead the operator, so the refactor must protect semantics before reducing file size.

Not intended to solve in this workstream:

- changing trading strategy logic
- changing external-service market-data or Polymarket service behavior
- redesigning the Trading Ops UI from scratch
- adding autonomous execution controls

---

## Development Overview

Mission Control should introduce a `TradingOpsReadModel` boundary that owns the operator-facing Trading Ops payload. The read model should aggregate completed-run truth, artifact fallback, live market data, Polymarket status, freshness policy, and source provenance into typed section models consumed by route handlers and UI components. Existing behavior should be migrated incrementally with tests moved from helper-level assertions to read-model boundary assertions.

---

## Success Metrics

- The Trading Ops page renders the same operator states before and after the refactor for existing test fixtures.
- A future change to latest-run truth, live quote state, or Polymarket status can be made by touching one read-model vertical instead of editing both loader and dashboard logic.
- `apps/mission-control/lib/trading-ops.ts` and `apps/mission-control/components/trading-ops-dashboard.tsx` each lose clear ownership of at least one major concern without reducing test coverage.
- Existing Mission Control tests remain green, with Trading Ops regression coverage moved toward public read-model interfaces.
- Operator-facing fallback labels remain explicit: DB-backed, file fallback, direct artifact read, stale, degraded, missing, and error states must not be collapsed.

---

## Assumptions

- Mission Control remains the browser-facing boundary for Trading Ops.
- external-service continues to own Schwab, Alpaca, Polymarket, streamer state, and provider-specific live endpoints.
- Completed trading-run truth remains preferred from Mission Control DB state where available, with artifact/file fallback only when DB state is absent or contradicted.
- Existing tests are good enough to serve as the behavior-preservation baseline.
- This planning package is docs-only and should not change runtime behavior.

---

## Out of Scope

- Any change to `apps/external-service` provider APIs.
- Any change to backtester trading strategies, scoring, authority policy, or execution rules.
- Replacing Prisma or changing the `mc_trading_runs` schema as part of the first refactor.
- Visual redesign of the Trading Ops dashboard.
- Removing existing safety/fallback wording.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Single read-model boundary](#single-read-model-boundary) | Trading Ops data shaping should be available through one small interface. | The implementation can stay internally split by vertical. |
| [Explicit provenance and fallback](#explicit-provenance-and-fallback) | Every section should expose its source and confidence/fallback state. | Operator wording must stay honest. |
| [UI simplification](#ui-simplification) | Dashboard components should render prepared section models instead of deriving source-of-truth semantics inline. | This is not a visual redesign. |
| [Behavior-preserving migration](#behavior-preserving-migration) | Existing test behavior must survive the refactor. | Prefer boundary tests over helper-only tests. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Trading Ops read model | Server-side operator payload consumed by the Trading Ops page and live routes. |
| Completed-run truth | Latest completed trading workflow state, preferably DB-backed from `mc_trading_runs`. |
| Live runtime truth | Quote, streamer, watchlist, and Polymarket state read through external-service. |
| Provenance | The source and confidence of a displayed section, such as DB-backed, artifact, fallback, stale, or degraded. |

---

### Single read-model boundary

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want Trading Ops to produce one coherent payload so that dashboard state reflects one source-of-truth decision path. | The interface should hide artifact paths, DB fallback, and external-service request details. |
| Proposed | As a developer, I want to change one Trading Ops vertical at a time so that Schwab, Polymarket, completed-run, and artifact-freshness work do not require global edits. | Internals can remain modular behind the boundary. |

---

### Explicit provenance and fallback

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want every degraded or fallback state to remain visible so that I do not mistake partial truth for full health. | Existing wording such as DB-backed and file fallback should remain explicit. |
| Proposed | As a developer, I want provenance to be typed so that UI code cannot silently drop warning context. | Section models should carry source, state, badge, message, warnings, and updated timestamps. |

---

### UI simplification

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want the same Trading Ops dashboard behavior after the refactor so that this work does not change decision support. | This is a structural refactor. |
| Proposed | As a developer, I want dashboard components to render prepared models so that UI tests can focus on presentation and read-model tests can focus on truth semantics. | Avoid duplicating source/fallback logic in React components. |

---

### Behavior-preserving migration

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a maintainer, I want test coverage to move toward the read-model interface so that internals can change without rewriting tests. | Replace redundant shallow helper tests after boundary tests exist. |
| Proposed | As an operator, I want the live stream and fallback polling behavior to remain stable during migration so that the page remains useful during market hours. | Make live-route changes later in the sequence. |

---

## Appendix

### Additional Considerations

Trading Ops currently combines two different truth families:

- completed-run truth from DB or artifacts
- live runtime truth from external-service

The read model should not hide that distinction. It should make the distinction easier to enforce.

### Open Questions And Recommended Answers

1. Should this refactor change user-facing Trading Ops behavior?
   Recommended answer: No. Behavior changes should be separate PRs after the read-model boundary exists.

2. Should the first vertical include Polymarket?
   Recommended answer: Not first. Start with completed-run/artifact truth, then live Schwab/watchlist truth, then Polymarket.

3. Should the UI be redesigned while splitting the model?
   Recommended answer: No. Keep visual scope out of this refactor.

4. Should existing helper tests be deleted immediately?
   Recommended answer: No. Add boundary tests first, then remove redundant helper tests only when they are clearly covered.

### Technical Considerations

- The current candidate files are `apps/mission-control/lib/trading-ops.ts`, `apps/mission-control/lib/trading-ops-live.ts`, `apps/mission-control/lib/trading-ops-polymarket.ts`, `apps/mission-control/lib/trading-ops-polymarket-live.ts`, `apps/mission-control/lib/trading-run-state.ts`, and `apps/mission-control/components/trading-ops-dashboard.tsx`.
- Existing tests in `apps/mission-control/lib/trading-ops.test.ts`, `apps/mission-control/lib/trading-ops-live.test.ts`, and `apps/mission-control/app/trading-ops/trading-ops-dashboard.test.tsx` provide the baseline behavior inventory.
