# Implementation Plan - Mission Control Trading Ops Read Model

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Trading Ops read model |
| Tech Spec | [Mission Control Trading Ops Read Model Tech Spec](./techspec-mission-control-trading-ops-read-model.md) |
| PRD | [Mission Control Trading Ops Read Model PRD](./prd-mission-control-trading-ops-read-model.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Read-model wrapper and boundary tests | None | Start Now |
| V2 - Completed-run and artifact truth extraction | V1 | Start after V1 |
| V3 - Live market-data adapter extraction | V1, V2 | Start after V1, V2 |
| V4 - Polymarket adapter extraction | V1 | Start after V1 |
| V5 - UI simplification and route alignment | V2, V3, V4 | Start after V2, V3, V4 |
| V6 - Test cleanup and operator validation | V5 | Start after V5 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3 + V4
Sprint 3: V5 + V6
```

---

## Sprint 1 - Boundary And Completed-Run Truth

### Vertical 1 - Read-model wrapper and boundary tests

**apps/mission-control: add the public read-model boundary without changing behavior**

*Dependencies: None*

#### Jira

- Sub-task 1: Add `apps/mission-control/lib/trading-ops-read-model.ts` with `loadTradingOpsReadModel(options)` wrapping the current `loadTradingOpsDashboardData(options)` from `apps/mission-control/lib/trading-ops.ts`.
- Sub-task 2: Add `apps/mission-control/lib/trading-ops-section.ts` with shared provenance/state types that extend the existing `ArtifactState` shape from `apps/mission-control/lib/trading-ops-contract.ts`.
- Sub-task 3: Add `apps/mission-control/lib/trading-ops-read-model.test.ts` with fixtures copied or adapted from `apps/mission-control/lib/trading-ops.test.ts`.
- Sub-task 4: Update `apps/mission-control/app/trading-ops/page.tsx` to call `loadTradingOpsReadModel()` and pass `readModel.dashboard` to `TradingOpsDashboard`.

#### Testing

- `pnpm --filter mission-control test`
- Boundary test proves wrapper output is equivalent to current dashboard data for representative fixtures.
- `/trading-ops` page still renders with the existing `TradingOpsDashboard` props.

---

### Vertical 2 - Completed-run and artifact truth extraction

**apps/mission-control: move latest-run/artifact source selection behind the read-model boundary**

*Dependencies: V1*

#### Jira

- Sub-task 1: Extract completed-run loading from `apps/mission-control/lib/trading-ops.ts` into a focused adapter, for example `apps/mission-control/lib/trading-ops-completed-runs.ts`.
- Sub-task 2: Keep `apps/mission-control/lib/trading-run-state.ts` as the DB/artifact source store, but make the read-model adapter own the final operator section state.
- Sub-task 3: Preserve current behavior for `loadLatestTradingRunOverview()` while redirecting it through the completed-run adapter or marking it as legacy compatibility.
- Sub-task 4: Move DB-backed versus file-fallback tests from helper-level assertions into `apps/mission-control/lib/trading-ops-read-model.test.ts`.

#### Testing

- DB-backed latest run remains preferred when it matches the latest completed artifact.
- File fallback remains explicit when DB state disagrees with artifact state.
- Direct artifact read remains distinguishable from file fallback.
- Missing latest-run artifacts produce a typed missing/degraded section instead of throwing.

---

## Sprint 2 - Live Inputs

### Vertical 3 - Live market-data adapter extraction

**apps/mission-control: isolate Schwab/watchlist live truth and retained quote behavior**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Keep current live route behavior in `apps/mission-control/lib/trading-ops-live.ts`, but extract external-service fetch and quote normalization into a dedicated adapter module if the extraction is low risk.
- Sub-task 2: Make retained Schwab quote behavior explicit in the section provenance model instead of only implicit in warnings.
- Sub-task 3: Preserve current `/api/trading-ops/live` and `/api/trading-ops/live/stream` route behavior.
- Sub-task 4: Add boundary tests for streamer disconnected plus REST working, missing quote rows, after-hours softening, and retained quote degradation.

#### Important Planning Notes

- Do not merge live runtime truth into completed-run truth. They answer different operator questions.
- Retained quotes are useful, but they must stay visibly degraded when the live source is not healthy.

#### Testing

- `apps/mission-control/lib/trading-ops-live.test.ts` still passes.
- `apps/mission-control/app/api/trading-ops/live/route.test.ts` still passes.
- `apps/mission-control/app/api/trading-ops/live/stream/route.test.ts` still passes.
- New read-model boundary tests assert source/freshness semantics for live sections.

---

### Vertical 4 - Polymarket adapter extraction

**apps/mission-control: isolate Polymarket aggregate/live warmup and degraded states**

*Dependencies: V1*

#### Jira

- Sub-task 1: Keep `apps/mission-control/lib/trading-ops-polymarket.ts` and `apps/mission-control/lib/trading-ops-polymarket-live.ts` route-compatible while moving shared warmup/provenance rules into the read-model section primitives.
- Sub-task 2: Preserve neutral warmup behavior before first live account/event/watchlist snapshots settle.
- Sub-task 3: Keep pinned-market mutation routes out of this refactor unless a type mismatch is discovered.
- Sub-task 4: Add read-model boundary tests for warmup, stream error, account state, signal overlay, linked watchlist, and results sections.

#### Important Planning Notes

- Polymarket is separate from Schwab tape status. Do not let a Polymarket stream outage imply Schwab market-data degradation, or vice versa.

#### Testing

- `apps/mission-control/lib/trading-ops-polymarket.test.ts` still passes.
- `apps/mission-control/lib/trading-ops-polymarket-live.test.ts` still passes.
- `apps/mission-control/app/api/trading-ops/polymarket/route.test.ts` still passes.
- `apps/mission-control/app/api/trading-ops/polymarket/live/route.test.ts` still passes.
- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.test.ts` still passes.

---

## Sprint 3 - UI And Cleanup

### Vertical 5 - UI simplification and route alignment

**apps/mission-control: make React render prepared section state instead of deriving source semantics**

*Dependencies: V2, V3, V4*

#### Jira

- Sub-task 1: In `apps/mission-control/components/trading-ops-dashboard.tsx`, move remaining source/fallback derivations into server-side section models where practical.
- Sub-task 2: Extract repeated panel fragments into smaller components under `apps/mission-control/components/trading-ops/` only when the extraction removes real duplicated behavior.
- Sub-task 3: Keep client-owned state in the dashboard component: active tab, EventSource subscriptions, fallback polling, pin mutation state, and transient live updates.
- Sub-task 4: Confirm route handlers in `apps/mission-control/app/api/trading-ops/**` either use the read-model adapters or intentionally stay route-specific.

#### Testing

- `apps/mission-control/app/trading-ops/trading-ops-dashboard.test.tsx` still passes.
- UI tests focus on rendering prepared state and client interactions.
- Read-model tests own source-of-truth and fallback semantics.

---

### Vertical 6 - Test cleanup and operator validation

**apps/mission-control: remove redundant shallow tests only after boundary coverage exists**

*Dependencies: V5*

#### Jira

- Sub-task 1: Audit `apps/mission-control/lib/trading-ops.test.ts` for tests made redundant by `apps/mission-control/lib/trading-ops-read-model.test.ts`.
- Sub-task 2: Delete only redundant helper-level tests whose behavior is now covered through the read-model boundary.
- Sub-task 3: Keep focused tests for standalone helpers that remain meaningful independent of read-model behavior.
- Sub-task 4: Run manual `/trading-ops` validation through the launchd-managed local app using `apps/mission-control/scripts/restart-mission-control.sh`.

#### Testing

- `pnpm --filter mission-control test`
- Manual `/trading-ops` smoke check confirms overview, live, watchlists, system health, deep dive, and Polymarket tabs render.
- Confirm fallback labels remain explicit in a known degraded/fallback fixture or live state.

---

## Dependency Notes

### V1 before all other verticals

The wrapper gives the project a stable public boundary and allows tests to lock current behavior before internals move.

### V2 before V3

Live watchlist rows depend on the latest trading-run watchlists. Completed-run source resolution should be stable before live watchlist behavior is reshaped.

### V3 and V4 before V5

UI simplification should happen after server-side section semantics are prepared. Otherwise React components will keep owning source/fallback logic.

### V5 before V6

Test cleanup is only safe after UI and route behavior are aligned with the read-model boundary.

---

## Scope Boundaries

### In Scope (This Plan)

- Add a Trading Ops read-model boundary.
- Preserve current Trading Ops behavior.
- Extract completed-run/artifact source selection by vertical.
- Extract live market-data and Polymarket section semantics by vertical.
- Move tests toward public read-model assertions.
- Simplify dashboard component ownership after semantics move server-side.

### External Dependencies

- external-service live endpoints stay stable:
  - `/market-data/quote/batch`
  - `/market-data/ops`
  - Polymarket live endpoints
- Existing Mission Control database state for `mc_trading_runs` remains available where configured.
- Backtester artifact paths and schemas remain compatible with current loaders.

### Integration Points

- `apps/mission-control/app/trading-ops/page.tsx`
- `apps/mission-control/app/api/trading-ops/live/route.ts`
- `apps/mission-control/app/api/trading-ops/live/stream/route.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/route.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/live/route.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.ts`
- `apps/mission-control/lib/trading-ops.ts`
- `apps/mission-control/lib/trading-ops-live.ts`
- `apps/mission-control/lib/trading-ops-polymarket.ts`
- `apps/mission-control/lib/trading-ops-polymarket-live.ts`
- `apps/mission-control/lib/trading-run-state.ts`
- `apps/mission-control/components/trading-ops-dashboard.tsx`

---

## Realistic Delivery Notes

- **Smallest credible path:** add the wrapper read model and boundary tests first, then migrate completed-run truth. That alone gives the codebase a safer interface without forcing a risky all-at-once rewrite.
- **Biggest risks:** accidental collapse of explicit fallback wording, duplicated source semantics between server and UI, retained quote state becoming invisible, and over-generalizing section types until domain detail is lost.
- **Assumptions:** no DB migration is required, route response shapes remain compatible, and existing tests are the baseline for behavior preservation.
- **Parallelism:** V3 and V4 can proceed in parallel after V1 if separate owners avoid touching the same dashboard component until V5.
