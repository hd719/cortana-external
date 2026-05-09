# QA Plan - Spartan WHOOP Live Events

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hd |
| Epic | Spartan WHOOP Live Events |
| PRD | [Spartan WHOOP Live Events PRD](./prd-spartan-whoop-live-events.md) |
| Tech Spec | [Spartan WHOOP Live Events Tech Spec](./techspec-spartan-whoop-live-events.md) |
| Implementation Plan | [Spartan WHOOP Live Events Implementation Plan](./implementation-spartan-whoop-live-events.md) |

---

## QA Goals

- Confirm WHOOP webhook ingress is publicly reachable over HTTPS without exposing Mission Control or broader external-service routes.
- Confirm `external-service` validates signatures, dedupes events, stores compact state, and ACKs quickly.
- Confirm async processing creates `whoop_event_analysis.v1` within the normal 60-second target.
- Confirm event bursts produce at most one Spartan Telegram message.
- Confirm `NO_REPLY` events still produce inspectable artifacts.
- Confirm Mjolnir shows webhook, cron, and manual WHOOP activity.
- Confirm Monitor owns repeated processing failures.
- Confirm existing daily, weekly, and monthly Spartan crons are not regressed.

---

## Automated Checks

| Area | Check | Expected Result |
|------|-------|-----------------|
| Signature validation | Valid WHOOP signed fixture | Returns `200` and stores one queued row. |
| Signature validation | Invalid signature | Returns `401` or `403`; no trusted event processing. |
| Signature validation | Stale timestamp | Rejects as replay risk. |
| Payload validation | Missing `trace_id`, `type`, `id`, or `user_id` | Returns `400`. |
| Dedupe | Same `trace_id` delivered twice | One event row; duplicate request returns `2XX`. |
| Coalescing | Same `event_type + resource_id` burst | One canonical analysis; sibling rows marked `coalesced`. |
| Processing | Valid queued event | Creates `whoop_event_analysis.v1` and marks event `processed`. |
| Processing failure | WHOOP snapshot fetch fails repeatedly | Attempts increment; row becomes `failed`; Monitor-visible state exists. |
| Notification policy | Low-value event | Stores artifact with `notification_status='no_reply'`; no Telegram send. |
| Notification policy | Message-worthy workout/sleep/recovery event | Sends one Spartan Telegram message and records delivery metadata. |
| Mjolnir API | `GET /api/mjolnir/whoop-events` | Returns webhook, cron, and manual rows in newest-first order. |
| Mjolnir replay | Missing confirmation | Returns `400` and does not requeue. |
| Mjolnir replay | Confirmed failed event | Returns `202` and requeues eligible event. |

Recommended commands after implementation:

```bash
pnpm --filter @cortana/external-service test
pnpm --filter @cortana/external-service typecheck
cd apps/mission-control && pnpm build
cd apps/mission-control && npx vitest run
```

For the sibling `cortana` repo, run the most specific Spartan fitness policy tests added with the implementation.

---

## Manual QA

### Local Signed Fixture

1. Start `external-service` locally with `WHOOP_WEBHOOK_ENABLED=true`.
2. Generate a fixture body containing `user_id`, `id`, `type`, and `trace_id`.
3. Sign `timestamp + raw_body` with `WHOOP_WEBHOOK_SECRET`.
4. POST to `http://127.0.0.1:3033/webhooks/whoop`.
5. Confirm response is `200`.
6. Confirm `whoop_webhook_events` has one queued row.
7. Wait for processor execution.
8. Confirm event becomes `processed` and `whoop_event_analysis` contains `schema_version='whoop_event_analysis.v1'`.

### Duplicate And Burst Behavior

1. POST the same signed fixture twice with the same `trace_id`.
2. Confirm the second request returns duplicate `2XX`.
3. POST multiple signed fixtures with different `trace_id` values but the same event type and resource id inside the coalescing window.
4. Confirm one canonical event is processed.
5. Confirm at most one notification can be sent.

### Public HTTPS Callback

1. Configure the chosen constrained HTTPS route for `/webhooks/whoop`.
2. Confirm Mission Control remains accessible only through the existing Tailscale operator path.
3. POST a signed fixture to the public callback URL.
4. Confirm the event is stored and processed.
5. Confirm unrelated public paths do not expose operator surfaces.

### WHOOP Dashboard / Real Event

1. Configure the public callback URL in the WHOOP Developer Dashboard.
2. Subscribe to all supported WHOOP event types.
3. Trigger a WHOOP test event if the dashboard supports it, or wait for a real workout/sleep/recovery update.
4. Confirm the webhook row appears in the database.
5. Confirm the Mjolnir panel shows the event.
6. Confirm Spartan sends a Telegram only if policy marks the event message-worthy.

### Mjolnir UI

1. Open `/mjolnir`.
2. Confirm WHOOP Live Events appears near the top of the route.
3. Confirm recent webhook, cron, and manual rows are shown together.
4. Confirm failed rows are visually distinct and include a compact error.
5. Confirm `NO_REPLY` rows are inspectable without looking like failures.
6. Reprocess a safe failed test event and confirm the UI updates after confirmation.

### Monitor Failure Path

1. Temporarily force WHOOP snapshot fetch failure in a local/test environment.
2. Process a signed fixture until retry policy marks the row failed.
3. Confirm Monitor/Mjolnir show the failure.
4. Confirm Spartan does not send a coaching message for the operational failure.
5. Restore the WHOOP service path and reprocess the test event.

### Regression: Existing Cron Messages

1. Run the existing daily/weekly/monthly WHOOP cron paths in the safest available test mode.
2. Confirm their outputs and Telegram behavior are unchanged.
3. Confirm each run writes a compact `whoop_activity_log` row with `source='cron'`.
4. Trigger a manual WHOOP refresh and confirm it writes `source='manual'`.

---

## End-To-End Acceptance Scenarios

### Scenario 1 - Workout Update, Useful Coaching

1. WHOOP sends `workout.updated`.
2. Webhook validates and ACKs under 2 seconds.
3. Processor fetches the full WHOOP snapshot.
4. Artifact is created within 60 seconds.
5. Policy marks the artifact message-worthy.
6. Spartan sends exactly one Telegram message.
7. Mjolnir shows processed and sent status.

### Scenario 2 - Recovery Update, No Reply

1. WHOOP sends `recovery.updated`.
2. Webhook validates and stores the event.
3. Processor creates an artifact.
4. Policy returns `NO_REPLY`.
5. No Telegram is sent.
6. Mjolnir shows the event as processed/no reply.

### Scenario 3 - Duplicate Delivery

1. WHOOP retries the same event with the same `trace_id`.
2. System returns `2XX`.
3. Only one canonical event row exists.
4. No duplicate artifact or Telegram message is created.

### Scenario 4 - Processor Failure

1. Webhook event is accepted.
2. WHOOP snapshot fetch or downstream processing fails repeatedly.
3. Event becomes failed with a compact error.
4. Monitor/Mjolnir show the failure.
5. Spartan does not send operational noise to Telegram.

---

## Restart Path

For external-service validation:

```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service
curl -sS http://127.0.0.1:3033/health
```

For launchd-managed Mission Control verification:

```bash
cd /Users/hd/Developer/cortana-external
bash apps/mission-control/scripts/restart-mission-control.sh
curl -sS http://127.0.0.1:3000/api/heartbeat-status
```

Use an alternate-port Mission Control instance only when the live operator dashboard should not be restarted.

---

## Release Criteria

- Database migration applied successfully.
- Webhook route disabled by default and enabled only after configuration.
- Signed local fixture passes.
- Public HTTPS fixture passes.
- WHOOP dashboard callback is configured and can deliver events.
- Mjolnir panel shows webhook, cron, and manual activity.
- Duplicate and coalescing tests prove at most one Telegram message per burst.
- Monitor shows repeated failures.
- Existing Spartan cron behavior remains unchanged.
- Rollback path is documented and tested by disabling `WHOOP_WEBHOOK_ENABLED`.

---

## Open Questions And Answers

1. Is browser automation required for this MVP?
   Answer: not required if Mission Control route/component tests cover the panel. A manual `/mjolnir` smoke test is still required before rollout.

2. Should QA wait for a real workout?
   Answer: no. Signed fixtures should validate ingress and processing first. A real WHOOP event is the final smoke test, not the first test.

3. Should QA send test operational failures through Spartan?
   Answer: no. Operational failure testing should prove Monitor/Mjolnir visibility and no Spartan coaching message.

4. Can the feature launch without the Mjolnir panel?
   Answer: no for this MVP. The user explicitly wants a visual operator surface in `/mjolnir`.
