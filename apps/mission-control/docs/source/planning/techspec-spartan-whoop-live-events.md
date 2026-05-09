# Technical Specification - Spartan WHOOP Live Events

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hd |
| Epic | Spartan WHOOP Live Events |
| PRD | [Spartan WHOOP Live Events PRD](./prd-spartan-whoop-live-events.md) |

---

## Development Overview

Spartan WHOOP Live Events adds a durable, low-noise live event path for WHOOP webhook notifications. `apps/external-service` will expose a narrow public HTTPS callback at `/webhooks/whoop`, validate WHOOP signatures from the raw request body, store an idempotent event row in Postgres, and ACK before any expensive work runs.

An async processor will claim queued events, coalesce rapid updates for the same WHOOP object, fetch the full WHOOP snapshot through the existing WHOOP service, emit a compact `whoop_event_analysis.v1` artifact, and route that artifact through the existing Spartan fitness alert policy. Spartan sends a Telegram message only when the policy returns a message-worthy result; otherwise the artifact is retained with `NO_REPLY`.

Mission Control's `/mjolnir` route will show recent WHOOP activity from webhook, cron, and manual sources. Monitor owns operational failures and repeated processing errors.

---

## Data Storage Changes

### Database Changes

Use the existing `cortana` Postgres database via `CORTANA_DATABASE_URL`. Add schema changes through `apps/mission-control/prisma/schema.prisma` and a matching `apps/mission-control/prisma/migrations/.../migration.sql` migration, which is the repo's active managed migration path. `external-service` already uses direct Postgres clients for runtime integrations; this feature should follow that pattern instead of introducing Prisma to `external-service`.

#### [NEW] public.whoop_webhook_events

Durable ingress and processing state for WHOOP webhook deliveries.

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Default `gen_random_uuid()`. |
| Unique, Not Null | trace_id | text | WHOOP webhook `trace_id`; exact dedupe key. |
| Not Null | whoop_user_id | text | WHOOP `user_id`. |
| Not Null | event_type | text | WHOOP event type, such as `workout.updated`. |
| Not Null | resource_id | text | WHOOP `id` for the workout, sleep, or recovery resource. |
| Not Null, Default `'queued'` | status | text | `queued`, `coalesced`, `processing`, `processed`, `failed`, `ignored`. |
| Not Null, Default now() | received_at | timestamptz | Server receive time. |
| Nullable | process_after | timestamptz | Used for short coalescing windows and retry delay. |
| Nullable | processing_started_at | timestamptz | Worker claim timestamp. |
| Nullable | processed_at | timestamptz | Successful processing timestamp. |
| Not Null, Default `0` | attempt_count | integer | Processing attempts. |
| Nullable | last_error | text | Truncated operator-readable error. |
| Nullable | coalesced_into_trace_id | text | Canonical event when this row is collapsed into another row. |
| Not Null, Default `true` | signature_valid | boolean | Stored after successful signature validation. |
| Not Null, Default `'{}'::jsonb` | payload_compact | jsonb | Minimal trusted payload metadata. |
| Nullable | raw_payload | jsonb | Bounded retention only, default 30 days. |
| Not Null, Default now() | created_at | timestamptz | Row creation time. |
| Not Null, Default now() | updated_at | timestamptz | Row update time. |

Recommended indexes:

- unique index on `trace_id`
- index on `(status, process_after, received_at)`
- index on `(event_type, resource_id, received_at desc)`
- index on `received_at desc`

#### [NEW] public.whoop_event_analysis

Compact analysis artifacts and notification outcomes.

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Default `gen_random_uuid()`. |
| Unique, Not Null | trace_id | text | References `whoop_webhook_events.trace_id`. |
| Not Null, Default `'whoop_event_analysis.v1'` | schema_version | text | Artifact schema version. |
| Not Null | source | text | `webhook`, `cron`, or `manual`. |
| Not Null | artifact | jsonb | Deterministic compact analysis artifact. |
| Not Null, Default `false` | notification_candidate | boolean | Policy says this may be worth messaging. |
| Not Null, Default `'no_reply'` | notification_status | text | `no_reply`, `queued`, `sent`, `failed`, `monitor_only`. |
| Nullable | spartan_session_key | text | Correlates a Spartan run or prompt execution when present. |
| Nullable | telegram_message_id | text | Telegram delivery id when sent. |
| Nullable | notified_at | timestamptz | Telegram send time. |
| Nullable | error | text | Notification or analysis error if applicable. |
| Not Null, Default now() | created_at | timestamptz | Row creation time. |
| Not Null, Default now() | updated_at | timestamptz | Row update time. |

Recommended indexes:

- index on `(source, created_at desc)`
- index on `(notification_status, created_at desc)`

#### [NEW] public.whoop_activity_log

Unified activity rows for the Mjolnir panel. Webhook processing writes this table directly. Existing cron and manual WHOOP refresh paths should add one compact activity row through a shared helper.

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Default `gen_random_uuid()`. |
| Unique, Not Null | trigger_key | text | Idempotency key, such as `webhook:<trace_id>`, `cron:<job_id>:<run_at>`, or `manual:<request_id>`. |
| Not Null | source | text | `webhook`, `cron`, or `manual`. |
| Not Null | activity_type | text | `workout`, `sleep`, `recovery`, `snapshot`, `delete`, or `unknown`. |
| Nullable | resource_id | text | WHOOP resource id when known. |
| Not Null | status | text | `queued`, `processed`, `failed`, `no_reply`, `sent`, `coalesced`. |
| Nullable | trace_id | text | Webhook trace id when present. |
| Nullable | analysis_id | uuid | References `whoop_event_analysis.id` when present. |
| Nullable | summary | text | Short UI summary. |
| Not Null, Default `'{}'::jsonb` | metadata | jsonb | Compact UI/debug metadata. |
| Not Null, Default now() | created_at | timestamptz | Activity time. |
| Not Null, Default now() | updated_at | timestamptz | Last update time. |

Recommended indexes:

- index on `(created_at desc)`
- index on `(source, created_at desc)`
- index on `(status, created_at desc)`

### Retention

- Keep compact `whoop_webhook_events`, `whoop_event_analysis`, and `whoop_activity_log` rows indefinitely.
- Delete or null `raw_payload` after `WHOOP_WEBHOOK_RAW_RETENTION_DAYS`, default 30.
- Never store WHOOP OAuth tokens, Telegram tokens, or full Spartan prompts in these rows.

---

## Infrastructure Changes

### SNS Topic Changes

None.

### SQS Queue Changes

None. The first release uses Postgres-backed queued rows plus a launchd-managed worker loop.

### Cache Changes

In-process coalescing state is allowed as an optimization only. Postgres `process_after`, event status, and unique keys remain the source of truth.

### S3 Changes

None.

### Secrets Changes

Add external-service configuration:

| Secret / Env Var | Purpose |
|------------------|---------|
| `WHOOP_WEBHOOK_ENABLED` | Enables the route and processor. Defaults off until ingress is configured. |
| `WHOOP_WEBHOOK_SECRET` | WHOOP app secret used for webhook HMAC validation. |
| `WHOOP_WEBHOOK_PUBLIC_URL` | Public callback URL configured in the WHOOP Developer Dashboard. |
| `WHOOP_WEBHOOK_RAW_RETENTION_DAYS` | Raw payload retention window. Default 30. |
| `WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS` | Max accepted signature timestamp age. Recommended 300. |

### Network/Security Changes

- Expose only `POST /webhooks/whoop` over public HTTPS.
- Prefer Tailscale Funnel if the route can be constrained to `/webhooks/whoop`; otherwise use a locked-down HTTPS tunnel such as Cloudflare Tunnel.
- Keep Mission Control, Codex Sessions, and operator surfaces reachable through the existing Tailscale path.
- Validate `X-WHOOP-Signature` and `X-WHOOP-Signature-Timestamp` before storing the event as trusted.
- Compute the expected signature from `timestamp_header + raw_http_request_body` using base64 SHA256 HMAC with `WHOOP_WEBHOOK_SECRET`.
- Enforce a body size cap and timestamp replay window.
- Invalid signatures return `401` or `403` with minimal logs and no processing.
- Duplicate `trace_id` deliveries return `2XX` idempotently to stop retries.

---

## Behavior Changes

- WHOOP webhook POSTs are ACKed quickly, target under 2 seconds.
- Webhook ingress performs validation, dedupe, durable storage, and enqueue only.
- Async processing claims queued rows and fetches a full WHOOP snapshot through the existing WHOOP service.
- Exact duplicate events dedupe by `trace_id`.
- Rapid updates coalesce for 30-60 seconds by `(event_type, resource_id)`.
- Delete events are stored and shown in Mjolnir, but they default to no coaching message.
- The processor creates one compact `whoop_event_analysis.v1` artifact for the canonical processed event.
- Spartan turns the artifact into human text only after the deterministic artifact exists.
- `NO_REPLY` is the default outcome for low-value events.
- Repeated processing failures appear in Monitor/Mjolnir, not as Spartan coaching messages.
- Existing daily, weekly, and monthly Spartan cron messages continue unchanged.

---

## Application/Script Changes

### `cortana-external`

- Add `apps/external-service/src/whoop/webhook-signature.ts` for raw-body HMAC verification.
- Add `apps/external-service/src/whoop/webhook-store.ts` for Postgres insert, claim, status, artifact, and activity-log operations.
- Add `apps/external-service/src/whoop/webhook-routes.ts` for `POST /webhooks/whoop`.
- Add `apps/external-service/src/whoop/webhook-processor.ts` for queued-event processing, coalescing, retry, and reconciliation.
- Update `apps/external-service/src/whoop/routes.ts` or route registration to mount the webhook endpoint without changing existing `/whoop/data` behavior.
- Update `apps/external-service/src/config.ts` for new WHOOP webhook env vars.
- Add Prisma schema and migration SQL under `apps/mission-control/prisma/` for the three WHOOP tables.
- Add `apps/mission-control/app/api/mjolnir/whoop-events/route.ts` for recent activity data.
- Add `apps/mission-control/app/api/mjolnir/whoop-events/[traceId]/reprocess/route.ts` for explicit operator replay.
- Update `apps/mission-control/app/mjolnir/page.tsx` or a new Mjolnir component to render the WHOOP Live Events panel near the top of the route.
- Update watchdog or monitor integration to report repeated failed events and stale processing queues.

### `cortana`

The Spartan policy and prompt surface lives in the sibling `cortana` repo. Implementation work should update it only where the coaching contract changes.

- Add a WHOOP live-event adapter that converts `whoop_event_analysis.v1` into the existing Spartan alert/coaching policy input shape.
- Reuse the existing Spartan alert policy instead of creating a parallel live-event messaging policy.
- Update the cron/manual WHOOP refresh paths to write `whoop_activity_log` rows through a small shared helper or external-service endpoint.
- Add tests around policy decisions for `NO_REPLY`, workout coaching, sleep/recovery coaching, and delete-event suppression.

---

## Artifact Contract

### `whoop_event_analysis.v1`

The artifact should be deterministic and compact. It should not include raw webhook payloads or full raw WHOOP API responses.

Recommended shape:

```json
{
  "schema_version": "whoop_event_analysis.v1",
  "source": "webhook",
  "trace_id": "whoop-trace-id",
  "event_type": "workout.updated",
  "resource_id": "12345",
  "activity_type": "workout",
  "observed_at": "2026-05-09T12:34:56Z",
  "snapshot_fetched_at": "2026-05-09T12:35:05Z",
  "summary": {
    "headline": "Workout updated",
    "changed_subject": "latest WHOOP workout",
    "readiness_context": "available"
  },
  "signals": {
    "strain": null,
    "recovery_score": null,
    "sleep_performance": null,
    "hrv": null,
    "resting_hr": null
  },
  "policy": {
    "decision": "NO_REPLY",
    "reason": "No actionable coaching change"
  },
  "debug": {
    "coalesced_count": 0,
    "processor_attempt": 1
  }
}
```

The exact `signals` fields should follow the data already available from the existing WHOOP service response. Missing values should be `null`, not invented.

---

## API Changes

### [NEW] WHOOP Webhook Callback

| Field | Value |
|-------|-------|
| **API** | `POST /webhooks/whoop` |
| **Owner** | `apps/external-service` |
| **Description** | Public HTTPS callback for WHOOP webhook notifications. |
| **Authentication** | WHOOP HMAC signature headers. |
| **Request** | WHOOP webhook JSON body with `user_id`, `id`, `type`, and `trace_id`. |
| **Success Response** | `200 { "ok": true, "status": "queued" }` or duplicate `200 { "ok": true, "status": "duplicate" }`. |
| **Error Responses** | `400` malformed body, `401/403` invalid signature, `503` feature disabled. |

### [NEW] Mjolnir WHOOP Activity List

| Field | Value |
|-------|-------|
| **API** | `GET /api/mjolnir/whoop-events` |
| **Owner** | `apps/mission-control` |
| **Description** | Returns recent WHOOP webhook, cron, and manual activity for the `/mjolnir` panel. |
| **Authentication** | Existing Mission Control operator boundary. |
| **URL Params** | Optional `limit`, `source`, `status`. |
| **Success Response** | `200 { events: [...] }`. |
| **Error Responses** | `500` database/runtime failure. |

### [NEW] Mjolnir WHOOP Event Reprocess

| Field | Value |
|-------|-------|
| **API** | `POST /api/mjolnir/whoop-events/[traceId]/reprocess` |
| **Owner** | `apps/mission-control` |
| **Description** | Requeues one failed or suppressed webhook event after explicit operator confirmation. |
| **Authentication** | Existing Mission Control operator boundary. |
| **Request** | `{ "confirm": true, "reason": "operator requested replay" }` |
| **Success Response** | `202 { "ok": true, "status": "queued" }`. |
| **Error Responses** | `400` missing confirmation, `404` unknown trace id, `409` already processing, `500` runtime failure. |

---

## Processing Lifecycle

1. WHOOP sends `POST /webhooks/whoop`.
2. `external-service` captures the raw body, validates the WHOOP signature, validates event shape, and inserts `whoop_webhook_events`.
3. If `trace_id` already exists, `external-service` returns duplicate `2XX` and does not enqueue another job.
4. New events get `status='queued'` and `process_after=now()+coalescing_delay`.
5. The worker claims due queued rows with row-level locking.
6. The worker marks newer or lower-priority rows for the same `(event_type, resource_id)` as `coalesced` when applicable.
7. The worker fetches the full WHOOP snapshot through the existing WHOOP service.
8. The worker builds and stores `whoop_event_analysis.v1`.
9. The Spartan live-event adapter evaluates the artifact through existing policy.
10. If policy returns `NO_REPLY`, the system records `notification_status='no_reply'`.
11. If policy returns message-worthy, Spartan creates the human text and sends one Telegram message.
12. The activity log and Mjolnir panel update with final status.
13. Repeated failures move to Monitor with operator-readable cause and next action.

---

## Rollout And Runtime

- Ship with `WHOOP_WEBHOOK_ENABLED=false`.
- Apply database migration.
- Deploy/restart `external-service`.
- Configure the constrained public HTTPS route.
- Set `WHOOP_WEBHOOK_PUBLIC_URL` and configure the same callback URL in the WHOOP Developer Dashboard.
- Enable webhook ingestion after a signed fixture test passes.
- Subscribe to all WHOOP webhook event types.
- Keep existing cron jobs running as fallback and comparison signal.

Rollback:

- Set `WHOOP_WEBHOOK_ENABLED=false`.
- Remove or disable the public tunnel route.
- Leave tables in place for audit unless a later cleanup is explicitly requested.
- Existing cron/manual WHOOP paths continue operating.

---

## Open Questions And Answers

1. Should Mission Control terminate the webhook?
   Answer: no. `external-service` owns provider auth and runtime ingestion. Mission Control only displays operator state.

2. Should every WHOOP event send a Telegram?
   Answer: no. Every event is stored and analyzed, but `NO_REPLY` remains the default policy outcome.

3. Should processing fetch only the changed WHOOP object?
   Answer: not in v1. Fetch the full snapshot for reliable context; optimize later if latency or API quota requires it.

4. Should quiet hours block messages?
   Answer: not in MVP. Quiet-hours policy can be layered later without changing ingress.

5. Should public ingress change Tailscale access to Mission Control?
   Answer: no. Public HTTPS is limited to `/webhooks/whoop`; Mission Control and Codex Sessions remain behind the current Tailscale operator path.
