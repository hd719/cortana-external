# Council Background Jobs Decision (Task 220)

## Decision
We are **not** introducing Graphile Worker right now.

## Why
- Mission Control currently has a small council workload and no dedicated worker infrastructure.
- Adding Graphile Worker would add operational overhead (schema bootstrap, worker process lifecycle, deployment health checks, retry/backoff policy management) before we need it.
- We already have a clean API surface and can run council fan-out through a protected job endpoint triggered by cron/webhook.

## Implemented approach
- Added `POST /api/council/jobs/deliberate` (token-protected via `MISSION_CONTROL_CRON_TOKEN`) to run a single deliberation fan-out pass.
- Added `lib/council-jobs.ts` with `runCouncilDeliberationFanout(sessionId)`.
- Fan-out currently creates explicit `fanout_dispatch` messages for pending members, producing an auditable queueing trail in `mc_council_messages`.

## Upgrade path to Graphile Worker
If council load increases, migrate this same unit of work into a Graphile Worker task:
1. Keep `runCouncilDeliberationFanout` as pure business logic.
2. Wrap it in a Graphile Worker task handler.
3. Replace cron-triggered API calls with DB-enqueued jobs.

This keeps the current implementation simple while preserving a low-friction path to full queue orchestration later.
