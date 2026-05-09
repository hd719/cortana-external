# Implementation Plan - Spartan WHOOP Live Events

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hd |
| Epic | Spartan WHOOP Live Events |
| PRD | [Spartan WHOOP Live Events PRD](./prd-spartan-whoop-live-events.md) |
| Tech Spec | [Spartan WHOOP Live Events Tech Spec](./techspec-spartan-whoop-live-events.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|--------------|------------|
| V1 - Webhook ingress and durable store | None | Start Now |
| V2 - Async processor and analysis artifact | V1 | Start after V1 |
| V3 - Spartan policy adapter and notification path | V2 | Start after V2 |
| V4 - Mjolnir visibility and replay controls | V1, V2 | Start after V1, V2 |
| V5 - Public HTTPS ingress, reconciliation, and Monitor | V1, V2, V3 | Start after V3 |
| V6 - QA, rollout, and runbook | V1-V5 | Start after V5 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3 + V4
Sprint 3: V5 + V6
```

---

## Sprint 1 - Runtime Ingress And Processing Core

### Vertical 1 - Webhook ingress and durable store

**apps/external-service: accept, validate, dedupe, and persist WHOOP webhook events**

*Dependencies: None*

#### Tasks

- Add `apps/mission-control/prisma/schema.prisma` models and a Prisma migration for `whoop_webhook_events`, `whoop_event_analysis`, and `whoop_activity_log`.
- Add webhook configuration to `apps/external-service/src/config.ts`.
- Add `apps/external-service/src/whoop/webhook-signature.ts` for WHOOP HMAC validation using raw request body bytes.
- Add `apps/external-service/src/whoop/webhook-store.ts` for Postgres inserts, duplicate detection, queue status, and activity-log writes.
- Add `apps/external-service/src/whoop/webhook-routes.ts` with `POST /webhooks/whoop`.
- Register the route without changing existing `/whoop/data`, health, or provider routes.
- Add minimal structured logs for accepted, duplicate, invalid, and failed ingress attempts.

#### Testing

- Valid signed payload returns `200` and inserts a queued event.
- Invalid signature returns `401` or `403` and does not enqueue processing.
- Stale timestamp returns a rejection.
- Duplicate `trace_id` returns `200` duplicate and leaves one event row.
- Malformed payload returns `400`.
- Route stays disabled when `WHOOP_WEBHOOK_ENABLED=false`.

---

### Vertical 2 - Async processor and analysis artifact

**apps/external-service: process queued events into compact deterministic artifacts**

*Dependencies: V1*

#### Tasks

- Add `apps/external-service/src/whoop/webhook-processor.ts`.
- Implement due-event claiming with row-level locking and `attempt_count`.
- Implement 30-60 second coalescing by `(event_type, resource_id)`.
- Fetch the full WHOOP snapshot using the existing WHOOP service path.
- Build `whoop_event_analysis.v1` with compact event metadata, snapshot signals, policy placeholder, and debug metadata.
- Store one analysis row and one activity-log row for processed events.
- Add retry/backoff and failed-state handling.
- Add a local worker loop under the launchd-managed external-service process or a small launchd-safe processor entrypoint.

#### Testing

- Queued event becomes `processed` and creates one analysis artifact.
- Rapid same-resource events coalesce into one canonical processing result.
- Delete events are logged and default to no coaching.
- WHOOP service failure increments attempt count and eventually marks failure.
- Processor restart can resume queued or failed-retryable rows.

---

## Sprint 2 - Spartan Policy And Operator UI

### Vertical 3 - Spartan policy adapter and notification path

**cortana + external-service: reuse Spartan policy and send Telegram only for useful coaching moments**

*Dependencies: V2*

#### Tasks

- In `/Users/hd/Developer/cortana`, add a live-event adapter that maps `whoop_event_analysis.v1` into the existing Spartan fitness alert policy shape.
- Keep `NO_REPLY` as the default result when the event does not create a useful coaching moment.
- Add a notification dispatcher path that sends one Spartan Telegram message only after policy approval.
- Record `notification_status`, `telegram_message_id`, `notified_at`, and any error on `whoop_event_analysis`.
- Ensure duplicate or coalesced events cannot send a second Telegram message.
- Update cron/manual WHOOP refresh flows to write `whoop_activity_log` rows, preserving existing daily, weekly, and monthly behavior.

#### Testing

- Workout update with message-worthy signals produces one Spartan notification candidate.
- Low-value update returns `NO_REPLY`.
- Delete events return `NO_REPLY` unless a later policy explicitly overrides them.
- Duplicate and coalesced rows do not produce duplicate Telegram sends.
- Existing Spartan cron tests remain green.

---

### Vertical 4 - Mjolnir visibility and replay controls

**apps/mission-control: show webhook, cron, and manual WHOOP activity inside `/mjolnir`**

*Dependencies: V1, V2*

#### Tasks

- Add `apps/mission-control/app/api/mjolnir/whoop-events/route.ts`.
- Add `apps/mission-control/app/api/mjolnir/whoop-events/[traceId]/reprocess/route.ts`.
- Add a WHOOP Live Events panel near the top of `apps/mission-control/app/mjolnir/page.tsx`.
- Show source, activity type, status, received/processed time, notification outcome, and short summary.
- Include compact detail for failed and suppressed events.
- Add explicit confirmation before reprocessing a webhook event.
- Keep the UI dense and operational; avoid turning this into a separate fitness inbox.

#### Testing

- `/mjolnir` renders recent webhook, cron, and manual rows.
- Failed rows are visually distinguishable and inspectable.
- Reprocess action requires confirmation and queues only eligible events.
- Empty state is clear when no WHOOP activity exists.
- Existing Mjolnir data and layout remain intact.

---

## Sprint 3 - Ingress Hardening, Monitor, And Rollout

### Vertical 5 - Public HTTPS ingress, reconciliation, and Monitor

**runtime: expose only the WHOOP callback, recover missed work, and alert on failures**

*Dependencies: V1, V2, V3*

#### Tasks

- Configure a constrained public HTTPS callback for `/webhooks/whoop`.
- Prefer Tailscale Funnel if it can be constrained to the webhook route; otherwise use a locked-down Cloudflare Tunnel.
- Set `WHOOP_WEBHOOK_PUBLIC_URL` and configure the WHOOP Developer Dashboard callback.
- Subscribe to all supported WHOOP event types.
- Add a 5-minute reconciliation fallback that finds queued/stale/failed-retryable rows and reclaims work.
- Add Monitor checks for repeated processing failures and stale webhook queues.
- Document restart, disable, replay, and rollback steps.

#### Testing

- Public URL reaches only the webhook path and does not expose Mission Control.
- WHOOP dashboard test event or signed fixture reaches `external-service`.
- Stale queued rows are recovered by reconciliation.
- Repeated failures show up in Monitor/Mjolnir, not Spartan.
- Disabling `WHOOP_WEBHOOK_ENABLED` stops ingestion while cron paths continue.

---

### Vertical 6 - QA, rollout, and runbook

**full stack: validate end to end and ship behind the feature flag**

*Dependencies: V1, V2, V3, V4, V5*

#### Tasks

- Run the QA plan in [Spartan WHOOP Live Events QA Plan](./qa-spartan-whoop-live-events.md).
- Add or update an operator runbook for WHOOP webhook setup and troubleshooting.
- Verify external-service health after restart.
- Verify Mission Control health after UI/API changes.
- Verify existing Spartan daily, weekly, and monthly cron behavior is unchanged.
- Enable webhook ingestion only after signed fixture, public ingress, and Mjolnir visibility pass.

#### Testing

- Automated tests pass for external-service, Mission Control, and relevant `cortana` policy changes.
- Manual signed fixture test passes locally.
- Public HTTPS fixture test passes.
- Mjolnir displays event status correctly.
- One real WHOOP event produces the expected artifact and either `NO_REPLY` or one Telegram message.

---

## Scope Boundaries

### In Scope

- WHOOP webhook ingress in `external-service`
- Durable event, analysis, and activity-log storage
- Async full-snapshot processing
- Spartan policy reuse for notification decisions
- Telegram send path for message-worthy live events
- Mjolnir visibility and replay controls
- Monitor visibility for repeated processing failures
- Public HTTPS route limited to the WHOOP webhook path

### Out of Scope

- Replacing existing Spartan cron messages
- Quiet-hours suppression
- Object-specific WHOOP API optimization
- Tonal or Apple Health webhook ingestion
- Broad public exposure of `external-service`
- A full Mission Control fitness inbox or chat surface

---

## Integration Points

- `apps/external-service/src/whoop/service.ts` for WHOOP data fetch.
- `apps/external-service/src/whoop/routes.ts` for existing WHOOP route patterns.
- `apps/external-service/src/config.ts` for environment configuration.
- `apps/mission-control/app/mjolnir/page.tsx` for UI placement.
- `apps/mission-control/app/api/mjolnir/route.ts` for existing Mjolnir API conventions.
- `/Users/hd/Developer/cortana/tools/fitness/fitness-alerts-data.ts` for Spartan fitness policy reuse.
- `/Users/hd/Developer/cortana/config/cron/jobs.json` for existing WHOOP cron context.
- Watchdog/Monitor runtime checks for repeated failures and stale queues.

---

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| WHOOP retries duplicate deliveries | Exact dedupe by `trace_id` and idempotent `2XX` duplicate ACK. |
| Event bursts cause duplicate Telegram messages | Coalesce by `(event_type, resource_id)` and make notification send idempotent per analysis. |
| Public ingress accidentally exposes operator services | Route only `/webhooks/whoop`; keep Mission Control on Tailscale. |
| Raw payloads grow indefinitely | Bound `raw_payload` retention and keep compact artifacts long-term. |
| WHOOP webhook missed or worker down | Keep cron paths and add 5-minute reconciliation. |
| Spartan becomes noisy | `NO_REPLY` default and reuse existing policy. |
| Cross-repo drift between runtime and Spartan policy | Update `cortana-external` runtime and `cortana` policy in the same implementation PR set. |

---

## Answered Implementation Questions

1. Where does the webhook live?
   Answer: `apps/external-service`, because it owns WHOOP auth and runtime provider integration.

2. Does the webhook request call Spartan directly?
   Answer: no. It stores and ACKs first; async processing creates the artifact; Spartan runs only after that.

3. Do we need a queue service?
   Answer: not for MVP. Postgres queued rows are enough and easier to operate on the Mac mini.

4. How do we keep this reachable while preserving Tailscale?
   Answer: expose only the webhook callback publicly; leave Mission Control and Codex Sessions on the existing Tailscale path.

5. What is the first rollback move?
   Answer: set `WHOOP_WEBHOOK_ENABLED=false` and disable the public tunnel route.
