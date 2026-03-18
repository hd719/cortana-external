# Go Entry Retirement: TypeScript Migration Plan

## Summary

Retire the current Go entrypoint and replace it with a TypeScript service that owns `127.0.0.1:3033`, preserves the existing public HTTP contract, and keeps behavior parity unless a hardening improvement is explicitly called out.

This is no longer a fitness-only refactor. The discovered live scope includes:

- Full Whoop surface
- Full Tonal surface
- Full Alpaca surface
- Aggregated `/health`
- Existing startup, watchdog, auth-alert, and file persistence behavior

## Why The Scope Changed

Repo inspection showed the original fitness-only framing was too narrow:

- [main.go](/Users/hd/Developer/cortana-external/main.go) serves Whoop, Tonal, Alpaca, and `/health` on the same public port.
- “TS owns `3033`” is incompatible with “Alpaca stays in Go” unless a proxy layer or second migration exists.
- The current TS schema package already drifts from live Go behavior:
  - [packages/fitness-types/src/common.ts](/Users/hd/Developer/cortana-external/packages/fitness-types/src/common.ts) does not allow `/health` status `degraded`.
  - [packages/fitness-types/src/whoop.ts](/Users/hd/Developer/cortana-external/packages/fitness-types/src/whoop.ts) omits `last_refresh_at` from stored Whoop tokens.
- Existing TS workspace conventions fit an app-level service better than a new library package.

## Decisions Locked

- TS will become the only public front door on `3033`.
- Full Go retirement is in scope, including Alpaca and aggregated `/health`.
- V1 optimizes for parity plus narrowly scoped hardening.
- The new server should live in `apps/external-service`, not `packages/fitness-service`.
- Tests should follow repo conventions: ESM, minimal `tsconfig`, `tsx`, Vitest 4, colocated `src/__tests__`.
- Subagents are allowed during implementation, but only as bounded workers on `gpt-5.3-codex`.

## Public Contract To Preserve

### Whoop

- `GET /auth/url`
- `GET /auth/callback`
- `GET /auth/status`
- `GET /whoop/health`
- `GET /whoop/data`
- `GET /whoop/recovery`
- `GET /whoop/recovery/latest`

### Tonal

- `GET /tonal/health`
- `GET /tonal/data`

### Alpaca

- `GET /alpaca/health`
- `GET /alpaca/account`
- `GET /alpaca/positions`
- `GET /alpaca/portfolio`
- `GET /alpaca/earnings`
- `GET /alpaca/quote/:symbol`
- `GET /alpaca/snapshot/:symbol`
- `GET /alpaca/bars/:symbol`
- `GET /alpaca/trades`
- `POST /alpaca/trades`
- `PUT /alpaca/trades/:id`
- `GET /alpaca/stats`
- `GET /alpaca/performance`

### Aggregate Health

- `GET /health`

## Required Behavioral Parity

- Whoop `/whoop/health` stays `200` with `status: "ok"` even when unauthenticated.
- Tonal `/tonal/health` stays `200` only when healthy and `503` when auth or user-info checks fail.
- `/health` continues to aggregate Whoop, Tonal, and Alpaca and returns `ok | degraded | unhealthy`.
- `/health` returns `503` only when all three services are unhealthy.
- Startup warmup remains non-fatal.
- Maintenance loop continues to run every 30 minutes with a 20 second timeout budget.
- All outbound API calls preserve the current 30 second timeout budget.
- Watchdog-visible endpoints keep their current status codes and response shapes.

## Intentional Hardening Allowed In V1

- Graceful shutdown and connection draining
- Contract fixtures and parity tests captured from live Go responses
- Coexistence-safe shadow-run file paths during validation
- Atomic Tonal cache writes
- Bounded Tonal cache eviction with logging
- Clearer port-conflict diagnostics

These are improvements, not parity requirements, and should be called out as such in implementation.

## Critical Migration Risks And Hardening Checklist

### DC-1: DateTime Serialization

- Read both Go RFC3339-with-offset timestamps and JS UTC ISO timestamps.
- Write ISO UTC strings from TS.
- Add migration tests using real Go-produced token files.

### DC-2: Tonal Workout ID Coercion

- Always coerce Tonal workout IDs to string before using them as object keys.
- Cover both numeric and string IDs in tests.

### DC-3: Graceful Shutdown

- Add signal handling for `SIGTERM` and `SIGINT`.
- Drain the server, stop maintenance timers, and flush pending writes before exit.

### DC-4: Zero-Time And Invalid Date Handling

- Treat missing, invalid, and zero-like expiry values as expired.

### DC-5: Empty Collection Serialization

- Preserve `[]`, `{}`, and `null` exactly where Go emits them.
- Never let `undefined` silently drop contract fields.

### DC-6: Timeout Budgets

- Preserve 30 second outbound timeout.
- Preserve 10 second `/health` budget.
- Preserve 20 second warmup and maintenance budgets.

### DC-7: Tonal Cache Growth

- Add bounded eviction as an explicit hardening improvement.
- Log when eviction occurs.

### DC-8: Warmup Is Non-Fatal

- Log failures, but do not block startup.

### DC-9: Port Conflict Detection

- Preserve the current “show the process on the port” behavior when bind fails.

### DC-10: Logging Parity

- Keep the current prefix-based operational logging style for Whoop, Tonal, Alpaca, startup, refresh, and shutdown events.

### DC-11: Shadow-Run File Safety

- During parity validation on a shadow port, use separate token and cache paths so the TS service cannot race the live Go service.

### DC-12: Contract Testing

- Capture fixtures from live Go endpoints and use them in TS contract tests.

### DC-13: Tonal Self-Heal Semantics

- Preserve Tonal’s 401/403 recovery flow:
  delete token file,
  re-authenticate,
  retry once,
  fail hard if retry is still unauthorized.

### DC-14: Whoop Refresh Deduplication

- Preserve singleflight-style token refresh dedupe so concurrent requests do not trigger duplicate refreshes.

### DC-15: Tonal Request Pacing

- Preserve the 500ms gap between sequential Tonal upstream calls.

### DC-16: Whoop Stale Cache Semantics

- Only serve stale disk cache on token validation or refresh failure.
- Preserve the `Warning: 110 - "Serving stale Whoop cache after token refresh failure"` response header.

### DC-17: Whoop Collection Fetch Bounds

- Preserve the current fetch bounds from Go rather than opportunistically expanding collection retrieval.

## Repo Alignment Changes

- Create `apps/external-service` as the deployable TS server entrypoint.
- Keep reusable shared schemas and client helpers in `packages/`.
- Update `@cortana/fitness-types` before treating it as the source of truth.
- Follow current repo package conventions:
  - ESM
  - direct `src` exports where relevant
  - minimal `tsconfig`
  - Vitest 4
  - colocated tests under `src/__tests__`

## Implementation Plan

### Phase 0: Capture Truth Before Rewriting

- Capture live Go fixtures for Whoop, Tonal, Alpaca, and `/health`.
- Inventory route shapes, headers, status codes, and side effects.
- Document any contract ambiguity discovered during capture.

### Phase 1: Align Shared Types And App Scaffold

- Add `apps/external-service`.
- Add config loading, logger, HTTP helpers, file-store helpers, retry helpers, and shutdown wiring.
- Update fitness schema drift before downstream TS code relies on it.

### Phase 2: Port Whoop

- Port auth URL, callback, auth status, health, data, recovery, and recovery latest handlers.
- Preserve token refresh logic, retry behavior, stale-cache fallback, warning header, and refresh dedupe.

### Phase 3: Port Tonal

- Port health and data handlers.
- Preserve refresh, password auth fallback, self-heal, one-retry semantics, request pacing, workout merge behavior, and cache shape.

### Phase 4: Port Alpaca

- Port all read endpoints plus trade write/update flows.
- Preserve PostgreSQL-backed trade behavior, key loading, health checks, and response envelopes.

### Phase 5: Port Server Integration

- Rebuild aggregated `/health`.
- Preserve startup warmup, proactive maintenance, bind behavior, and launchd-compatible cwd assumptions.
- Update `launchd-run.sh` only after parity validation succeeds.

### Phase 6: Shadow Run And Cutover

- Run TS on a shadow port with shadow file paths.
- Diff live responses against Go fixtures and exercise watchdog-visible endpoints.
- Cut over `3033` to TS only after shadow validation passes.
- Remove the Go entrypoint after stable cutover.

## Test Plan

- Contract tests for all public routes above, using captured Go fixtures.
- Migration tests for real Go token and cache files.
- Concurrency tests for Whoop token refresh dedupe.
- Self-heal tests for Tonal unauthorized retry behavior.
- Persistence tests for atomic writes and null-vs-undefined behavior.
- Integration tests for `/health` aggregation.
- End-to-end validation for launchd startup behavior and watchdog-visible endpoints.
- Alpaca tests covering both read routes and DB-backed trade mutations.

## Subagent Plan For Implementation

Use subagents only after scaffold and contract fixtures are in place.

- Main agent:
  owns server scaffold, shared infra, schema alignment, `/health`, rollout, verification, and final review.
- Worker 1 on `gpt-5.3-codex`:
  owns Whoop implementation.
- Worker 2 on `gpt-5.3-codex`:
  owns Tonal implementation.
- Worker 3 on `gpt-5.3-codex`:
  owns Alpaca implementation.

The write scopes must stay disjoint to avoid coordination waste and token churn.

## Acceptance Criteria

- TS can fully replace `main.go` on `127.0.0.1:3033`.
- Public routes, status codes, headers, and core response shapes match current Go behavior.
- Watchdog checks continue to pass after cutover.
- OpenClaw cron consumers continue to work without changes.
- Alpaca trade workflows still function against PostgreSQL.
- The remaining Go service entrypoint is removable after successful cutover validation.

## Implementation Gate

Do not start implementation until this plan has been reviewed and approved.
