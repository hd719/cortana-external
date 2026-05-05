# Implementation Plan - Mission Control API Route Contracts

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control API route contracts |
| Tech Spec | [Mission Control API Route Contracts Tech Spec](./techspec-mission-control-api-route-contracts.md) |
| PRD | [Mission Control API Route Contracts PRD](./prd-mission-control-api-route-contracts.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Helper design and tests | None | Start Now |
| V2 - Low-risk read routes | V1 | Start after V1 |
| V3 - Mutation and token routes | V1, V2 | Start after V1, V2 |
| V4 - Stream helper decision | V1, V2 | Start after V1, V2 |
| V5 - Cleanup and documentation | V2, V3, V4 | Start after V2, V3, V4 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3
Sprint 3: V4 + V5
```

---

## Sprint 1 - Shared Helpers And Read Routes

### Vertical 1 - Helper design and tests

**apps/mission-control: formalize route contract helpers**

*Dependencies: None*

#### Jira

- Sub-task 1: Extend `apps/mission-control/lib/api-route.ts` with helper variants for read, mutation, and machine-ingress routes.
- Sub-task 2: Extend `apps/mission-control/lib/api-auth.ts` types or exports so routes declare policy explicitly.
- Sub-task 3: Add `apps/mission-control/lib/api-route.test.ts`.

#### Testing

- Helper tests cover success, thrown `ApiError`, generic error, invalid JSON, no-store headers, and auth rejection.

---

### Vertical 2 - Low-risk read routes

**apps/mission-control: migrate simple GET routes first**

*Dependencies: V1*

#### Jira

- Sub-task 1: Migrate `apps/mission-control/app/api/agents/route.ts`.
- Sub-task 2: Migrate `apps/mission-control/app/api/usage/route.ts`.
- Sub-task 3: Migrate `apps/mission-control/app/api/autonomy-ops/route.ts`.
- Sub-task 4: Migrate `apps/mission-control/app/api/docs/route.ts`.

#### Testing

- Existing route tests pass.
- Response payloads are unchanged.

---

## Sprint 2 - Mutations And Machine Ingress

### Vertical 3 - Mutation and token routes

**apps/mission-control: migrate routes where auth policy matters most**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Migrate `apps/mission-control/app/api/services/workspace/route.ts`.
- Sub-task 2: Migrate selected approval/feedback mutation routes only after same-origin tests exist.
- Sub-task 3: Migrate machine-ingress routes only after token-auth tests exist.

#### Testing

- Cross-origin mutation rejected.
- Token route rejects missing token.
- Happy-path response unchanged.

---

## Sprint 3 - Streams And Cleanup

### Vertical 4 - Stream helper decision

**apps/mission-control: decide whether SSE routes need a stream-specific helper**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Review `apps/mission-control/app/api/codex/streams/[streamId]/route.ts`.
- Sub-task 2: Review `apps/mission-control/app/api/trading-ops/live/stream/route.ts`.
- Sub-task 3: Review `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.ts`.
- Sub-task 4: Add a stream helper only if it removes duplicated keepalive/error behavior without hiding domain-specific stream events.

#### Testing

- Existing stream route tests pass.
- Keepalive and completion behavior remain unchanged.

---

### Vertical 5 - Cleanup and documentation

**apps/mission-control: remove duplicated route boilerplate where helpers now own it**

*Dependencies: V2, V3, V4*

#### Jira

- Sub-task 1: Remove route-local error helpers made redundant by `api-route.ts`.
- Sub-task 2: Document the route policy choices in Mission Control docs or README.
- Sub-task 3: Audit direct `NextResponse.json` uses and classify remaining ones as intentional or migration backlog.

#### Testing

- `pnpm --filter mission-control test`

---

## Scope Boundaries

### In Scope (This Plan)

- Route helper API.
- Explicit auth policy.
- Incremental route migration.
- Route tests.

### External Dependencies

- Next.js App Router.

### Integration Points

- `apps/mission-control/lib/api-route.ts`
- `apps/mission-control/lib/api-auth.ts`
- `apps/mission-control/app/api/**`

---

## Realistic Delivery Notes

- **Smallest credible path:** helper tests plus a few read-route migrations.
- **Biggest risks:** accidental auth or response-shape drift.
- **Assumptions:** route response envelopes remain route-specific.
