# Vacation Ops Regression Notes

This note captures the concrete Vacation Ops failures we hit during hardening so future regressions can be triaged from operator symptom to code seam quickly.

## Scope

- `cortana` owns Vacation Ops orchestration, readiness checks, remediation, and staged-window lifecycle.
- `cortana-external` owns the Mission Control read model, operator controls, and stale-state reconciliation shown in the UI.
- Most serious regressions crossed both repos, so treat Vacation Ops as a split-brain system when debugging it.

Related planning and QA docs live in the sibling `cortana` repo:

- `docs/source/planning/openclaw/prd/prd-vacation-ops-mode.md`
- `docs/source/planning/openclaw/techspec/techspec-vacation-ops-mode.md`
- `docs/source/planning/openclaw/implementation/implementation-vacation-ops-mode.md`
- `docs/source/planning/openclaw/qa/qa-spec-vacation-ops-mode.md`

## Current invariants

- A staged window may be `prep`, `ready`, or `failed`, but `prep` must only represent an actively running readiness pass.
- A completed readiness run must leave the staged window in `ready` or `failed`, never stranded in `prep`.
- An accidental staged window must be cancelable from Mission Control.
- `Telegram Delivery` should only be red when transport config or recent delivery evidence is actually bad.
- Remediation actions must be independent of the caller working directory.

## Regression inventory

### 1. Stuck preflight left the window in `prep`

Symptoms:

- Mission Control showed `Planning` / `Preflight is still running` indefinitely.
- The latest window row stayed `status = 'prep'`.
- A later readiness run could complete green, but the UI still looked stuck.

Root cause:

- `prepare` marked the window row `prep` up front.
- If the preflight flow died before its final state write, the staged window stayed stranded in `prep`.
- Mission Control originally trusted that stale window row and did not reconcile it against later readiness truth.

Fixes:

- `cortana` hardened preflight state so hung checks time out and failed/hung readiness runs do not remain orphaned (`#538`).
- `cortana-external` added `deriveVacationPrepRepair(...)` in `apps/mission-control/lib/vacation-ops.ts` and now repairs snapshot state when:
  - a `prep` window has a later completed readiness run for the same window
  - a `prep` window has a `running` readiness run older than 15 minutes
- The Mission Control read path now promotes the staged window to `ready` or `failed` from the actual readiness result and cancels stale `running` readiness rows (`#316`).

Regression checks:

- `apps/mission-control/lib/vacation-ops.test.ts`
- `apps/mission-control/lib/vacation-ops.ts`
- `cortana/tools/vacation/vacation-ops.ts`

### 2. Accidental staged windows could not be cleared cleanly

Symptoms:

- A window was staged by accident and remained visible even though it should never be enabled.
- Operators had no first-class Mission Control control to clear the staged window.

Root cause:

- Vacation Ops lacked a complete staged-window cancel path in the runtime and UI.

Fixes:

- `cortana` added a real staged-window cancel path as part of the preflight guard work.
- `cortana-external` added a `Cancel staged` control in `apps/mission-control/app/services/tabs/vacation-ops-tab.tsx` so `prep`, `ready`, and `failed` windows can be cleared before activation (`#313`).

Regression checks:

- The Vacation Ops tab should expose `Cancel staged` whenever the visible non-active window is cancelable.
- Cancelling a staged window should move the window out of operator-facing staging state without requiring DB surgery.

### 3. `Telegram Delivery` showed false red during readiness

Symptoms:

- Vacation Ops incidents showed `Telegram Delivery` as red or degraded.
- The live runtime was actually healthy, and delivery evidence existed or transport was configured correctly.

Root cause:

- The readiness check parser was anchored to an older `openclaw status` output shape.
- Newer table-format status output was treated as missing transport config, which created false-red readiness failures.

Fixes:

- `cortana` updated the Telegram transport detector in `tools/vacation/vacation-checks.ts` and locked it in with fixtures in `tests/vacation/vacation-checks.test.ts` (`#539`).

Regression checks:

- `tests/vacation/vacation-checks.test.ts`
- Compare the current `openclaw status` output format against the parser expectations before assuming the transport is actually down.

### 4. `runtime_sync` remediation failed when called from the wrong working directory

Symptoms:

- Vacation remediation reached the `runtime_sync` step and failed even though the runtime itself was healthy.
- The failure was easiest to reproduce when the caller was not running from the `cortana` repo root.

Root cause:

- The cron/runtime sync command derived source paths from the caller working directory instead of from the script location or explicit arguments.

Fixes:

- `cortana` changed sync path resolution to be source-relative and made Vacation remediation pass explicit `--repo-root` and `--runtime-home` targets into `sync-cron-to-runtime.ts` (`#541`).

Regression checks:

- `tests/cron/sync-cron-to-runtime.test.ts`
- `tests/vacation/vacation-remediation.test.ts`
- Manual reproduction should still pass when running Vacation readiness from outside the `cortana` repo root.

## Where the protection lives now

- Mission Control read model and stale-state repair:
  - `apps/mission-control/lib/vacation-ops.ts`
- Mission Control operator controls and status wording:
  - `apps/mission-control/app/services/tabs/vacation-ops-tab.tsx`
- Runtime orchestration boundary:
  - `cortana/tools/vacation/vacation-coordinator.ts`
- Readiness checks and Telegram detection:
  - `cortana/tools/vacation/vacation-checks.ts`
- Remediation ladder and runtime sync targeting:
  - `cortana/tools/vacation/vacation-remediation.ts`
  - `cortana/tools/cron/sync-cron-to-runtime.ts`

## Fast regression triage

1. Hit `/api/vacation-ops` and inspect `mode`, `latestWindow.status`, `latestReadiness.state`, `latestReadiness.readinessOutcome`, and `activeIncidents`.
2. If the latest window is `prep` but the latest readiness run is already `completed`, the Mission Control reconcile path is broken or missing.
3. If the latest window is `prep` and the latest readiness run has been `running` for more than 15 minutes, stale-run cancellation is broken.
4. If `Telegram Delivery` is red with otherwise healthy runtime surfaces, compare the current `openclaw status` output with the parser fixtures in `tests/vacation/vacation-checks.test.ts`.
5. If remediation fails on `runtime_sync`, verify the spawned command includes explicit `--repo-root` and `--runtime-home`.

## Merged fixes to compare against

- `cortana-external #313` — add vacation staging cancel control
- `cortana-external #316` — reconcile stale vacation preflight state
- `cortana #538` — guard vacation preflight against hung checks
- `cortana #539` — fix vacation Telegram transport detection
- `cortana #541` — harden vacation remediation paths
