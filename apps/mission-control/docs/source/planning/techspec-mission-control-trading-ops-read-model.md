# Technical Specification - Mission Control Trading Ops Read Model

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Trading Ops read model |

---

## Development Overview

Mission Control should introduce a `TradingOpsReadModel` boundary that owns the operator-facing Trading Ops payload. The read model should aggregate completed-run truth, artifact fallback, live market data, Polymarket status, freshness policy, and source provenance into typed section models consumed by route handlers and UI components. Existing behavior should be migrated incrementally with tests moved from helper-level assertions to read-model boundary assertions.

---

## Data Storage Changes

### Database Changes

None required for the first refactor.

The refactor should continue reading existing Mission Control DB state through `apps/mission-control/lib/trading-run-state.ts`, including the current `mc_trading_runs` backing store. If future work needs persistent read-model snapshots, that should be proposed separately after the boundary is in place.

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

None.

### SQS Queue Changes

None.

### Cache Changes

No new cache is required. Existing in-process retained quote behavior in `apps/mission-control/lib/trading-ops-live.ts` should be preserved until it can be moved behind a dedicated live quote adapter.

### S3 Changes

None.

### Secrets Changes

None.

### Network/Security Changes

None. Mission Control continues to read live trading data through the existing external-service boundary. The browser must not call Schwab, Alpaca, Polymarket, or backtester files directly.

---

## Behavior Changes

This is intended to be behavior-preserving.

Expected visible behavior after the refactor:

- `/trading-ops` still renders the same overview, live, watchlists, system health, deep dive, and Polymarket tabs.
- `/api/trading-ops/live` and `/api/trading-ops/live/stream` still return the same effective live payload shapes.
- `/api/trading-ops/polymarket`, `/api/trading-ops/polymarket/live`, and `/api/trading-ops/polymarket/live/stream` still preserve current warmup, fallback, and error semantics.
- Operator-facing source labels remain explicit: DB-backed, file fallback, direct artifact read, stale, degraded, missing, and error.

Behavior that should become easier to reason about:

- which source won for latest-run truth
- whether live data is current, retained, fallback, degraded, or missing
- whether Polymarket is warming up, connected, degraded, or unavailable
- which warnings are operator-actionable

---

## Application/Script Changes

### New modules

#### `apps/mission-control/lib/trading-ops-read-model.ts`

Owns the small public interface for dashboard-level Trading Ops data.

Recommended interface:

```ts
export type TradingOpsReadModelOptions = {
  repoPath?: string;
  cortanaRepoPath?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type TradingOpsReadModel = {
  dashboard: TradingOpsDashboardData;
  provenance: TradingOpsProvenanceSummary;
};

export async function loadTradingOpsReadModel(
  options?: TradingOpsReadModelOptions,
): Promise<TradingOpsReadModel>;
```

The first implementation may wrap the current `loadTradingOpsDashboardData` behavior and then absorb internals by vertical.

#### `apps/mission-control/lib/trading-ops-section.ts`

Owns shared section-state helpers so every section carries consistent source and warning metadata.

Recommended interface:

```ts
export type TradingOpsSection<T> = ArtifactState<T> & {
  provenance: {
    sourceKind: "db" | "artifact" | "external-service" | "derived" | "fallback";
    confidence: "high" | "medium" | "low";
    freshnessSeconds: number | null;
  };
};
```

#### `apps/mission-control/lib/trading-ops-read-model.test.ts`

New boundary tests for end-to-end read-model behavior using existing fixtures and local stand-ins.

### Updated modules

#### `apps/mission-control/lib/trading-ops.ts`

Current role: large dashboard loader, artifact parser, external-service health aggregator, source selector, and display-state builder.

Target role: completed-run/artifact source adapter and legacy compatibility layer during migration. Long term, dashboard-level orchestration should move into `trading-ops-read-model.ts`.

#### `apps/mission-control/lib/trading-ops-live.ts`

Current role: live quote/watchlist loader, external-service request client, streamer summarizer, retained quote state, after-hours handling, and display-state builder.

Target role: live market-data adapter behind the read-model boundary.

#### `apps/mission-control/lib/trading-ops-polymarket.ts`

Current role: Polymarket aggregate status loader and UI artifact builder.

Target role: Polymarket aggregate adapter behind the read-model boundary.

#### `apps/mission-control/lib/trading-ops-polymarket-live.ts`

Current role: Polymarket live endpoint loader and normalization.

Target role: Polymarket live adapter behind the read-model boundary.

#### `apps/mission-control/lib/trading-run-state.ts`

Current role: DB-backed latest-run state store, artifact sync, and DB-vs-artifact source resolution.

Target role: completed-run source adapter used by the read model.

#### `apps/mission-control/components/trading-ops-dashboard.tsx`

Current role: renders the dashboard and performs several client-side fetch/SSE/fallback behaviors while also deriving some display state.

Target role: render prepared read-model sections and own only client interaction state such as active tab, live stream subscription, optimistic pin changes, and visual layout.

---

## API Changes

### [UPDATE] Trading Ops Dashboard Server Loader

| Field | Value |
|-------|-------|
| **API** | Server-side `loadTradingOpsReadModel()` |
| **Description** | New internal read-model boundary for the `/trading-ops` page. |
| **Additional Notes** | Starts as a wrapper, then becomes the primary owner of source selection and section provenance. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal server call only |
| **URL Params** | None |
| **Request** | `TradingOpsReadModelOptions` |
| **Success Response** | `{ dashboard, provenance }` |
| **Error Responses** | Should return typed degraded/error section states instead of throwing for recoverable source failures. |

### [UPDATE] `GET /api/trading-ops/live`

No route shape change in the first migration. The route may call the read model or a read-model live adapter after live truth is migrated.

### [UPDATE] `GET /api/trading-ops/polymarket`

No route shape change in the first migration. The route may call the read model or a read-model Polymarket adapter after Polymarket truth is migrated.

---

## Process Changes

- Refactor in verticals, not as one large rewrite.
- Keep every migration PR behavior-preserving unless explicitly scoped otherwise.
- Add read-model boundary tests before deleting helper-level tests.
- Keep current Mission Control launch/restart flow unchanged.

---

## Orchestration Changes

None.

---

## Test Plan

### Boundary tests

Add `apps/mission-control/lib/trading-ops-read-model.test.ts` to cover:

- DB-backed latest trading run wins when it matches the latest completed artifact.
- File fallback remains explicit when DB state disagrees with artifact state.
- Missing artifacts produce missing/degraded sections without throwing.
- Stale control-loop and canary artifacts remain clearly marked.
- Streamer disconnected plus REST working is degraded, not healthy.
- Polymarket warmup is neutral before first live snapshots settle.

### Existing tests to preserve

- `apps/mission-control/lib/trading-ops.test.ts`
- `apps/mission-control/lib/trading-ops-live.test.ts`
- `apps/mission-control/lib/trading-ops-polymarket.test.ts`
- `apps/mission-control/lib/trading-ops-polymarket-live.test.ts`
- `apps/mission-control/app/trading-ops/trading-ops-dashboard.test.tsx`
- `apps/mission-control/app/api/trading-ops/live/route.test.ts`
- `apps/mission-control/app/api/trading-ops/live/stream/route.test.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/route.test.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/live/route.test.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.test.ts`

### Manual checks

- `pnpm --filter mission-control test`
- Open `/trading-ops` locally after `apps/mission-control/scripts/restart-mission-control.sh`.
- Confirm overview source labels remain explicit.
- Confirm live stream reconnect/fallback behavior still shows degraded states rather than healthy states when streams are unavailable.

---

## Risks / Open Questions

### Risk: accidental behavior change during extraction

Mitigation: start with a wrapper read model and add boundary tests before moving internals.

### Risk: section model becomes too generic

Mitigation: keep the public read-model interface small but allow domain-specific section payloads. Do not force Polymarket, latest-run truth, and live quotes into one lossy generic shape.

### Risk: UI split creates duplicated source logic

Mitigation: move semantics server-side first. UI components should render state, source, warnings, and actions from prepared models.

### Open question: should live SSE routes use the full read model?

Recommended answer: not initially. Keep live routes narrow until the dashboard read model is stable, then decide whether live adapters should share the same provenance primitives.
