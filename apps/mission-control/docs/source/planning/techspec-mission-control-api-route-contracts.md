# Technical Specification - Mission Control API Route Contracts

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control API route contracts |

---

## Development Overview

Mission Control should standardize route handlers around a small set of contract helpers: read route, mutation route, machine-ingress route, and stream route. The helpers should own JSON parsing, typed error responses, cache headers, auth policy, and consistent response mechanics while leaving domain logic in `lib/*` modules.

---

## Data Storage Changes

None.

---

## Infrastructure Changes (if any?)

None.

---

## Behavior Changes

No intentional route behavior changes in the first migration.

Allowed behavior-preserving internal changes:

- consistent no-store/cache headers where routes already intend no-store
- consistent invalid JSON body handling
- consistent thrown error mapping
- explicit auth policy declarations

Disallowed first-pass changes:

- changing success payload shapes
- changing status codes without route-specific approval
- changing browser access model
- moving routes to a new framework

---

## Application/Script Changes

### Update `apps/mission-control/lib/api-route.ts`

Add or formalize helper variants:

```ts
export function readRoute<TParams, TResult>(options: RouteOptions<TParams, TResult>);
export function mutationRoute<TParams, TBody, TResult>(options: BodyRouteOptions<TParams, TBody, TResult>);
export function machineIngressRoute<TParams, TBody, TResult>(options: BodyRouteOptions<TParams, TBody, TResult>);
```

Each helper should support:

- route params
- optional body parsing
- explicit auth policy
- no-store option
- typed `ApiError`
- default error response

### Update `apps/mission-control/lib/api-auth.ts`

Clarify exported policies:

- `none`
- `same-origin`
- `machine-token`
- `configured-token-required`

Do not hide policy behind environment inference in route files.

### Route migration candidates

Start with low-risk route families:

- `apps/mission-control/app/api/agents/route.ts`
- `apps/mission-control/app/api/usage/route.ts`
- `apps/mission-control/app/api/services/workspace/route.ts`
- `apps/mission-control/app/api/autonomy-ops/route.ts`
- `apps/mission-control/app/api/docs/route.ts`

Defer high-risk route families:

- `apps/mission-control/app/api/codex/streams/[streamId]/route.ts`
- `apps/mission-control/app/api/trading-ops/live/stream/route.ts`
- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.ts`

---

## API Changes

### [UPDATE] Internal route helper API

| Field | Value |
|-------|-------|
| **API** | `readRoute`, `mutationRoute`, `machineIngressRoute` |
| **Description** | Shared wrappers for Next.js App Router handlers. |
| **Additional Notes** | External HTTP response shapes should remain unchanged by migration. |

---

## Process Changes

- Migrate route families in small PRs.
- Each migrated route keeps or adds route-level tests before migration.
- Run full Mission Control tests after each route family.

---

## Orchestration Changes

None.

---

## Test Plan

Add or extend:

- `apps/mission-control/lib/api-route.test.ts`
- `apps/mission-control/lib/api-auth.test.ts`

Migration tests:

- successful route response unchanged
- invalid JSON body returns expected status
- same-origin mutation rejects cross-origin requests
- machine-ingress route rejects missing or wrong token
- thrown `ApiError` maps to intended status and payload
- generic error maps to safe fallback message

Run:

- `pnpm --filter mission-control test`

---

## Risks / Open Questions

### Risk: wrapper hides route-specific behavior

Mitigation: allow route-specific `errorResponse` and response shaping. Do not force a universal envelope.

### Risk: auth regression

Mitigation: every migrated mutation or machine-ingress route must include auth tests.

### Open question: should all GET routes be public inside private-network Mission Control?

Recommended answer: no global rule. Keep explicit route policy even when the policy is `none`.
