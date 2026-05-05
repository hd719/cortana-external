# Product Requirements Document (PRD) - Mission Control API Route Contracts

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control API route contracts |

---

## Problem / Opportunity

Mission Control has many API routes with repeated response, error, auth, and JSON-body handling. A small route helper already exists, but most routes still hand-roll `NextResponse.json`, request parsing, and error mapping.

The opportunity is to deepen route handling behind a shared API contract layer so new routes are easier to write, security policy is easier to audit, and response behavior is consistent.

---

## Insights

- `apps/mission-control/lib/api-route.ts` exists but is only used by a small subset of routes.
- More than 50 route files still call `NextResponse.json` directly.
- Auth behavior is split between same-origin browser mutations, machine-ingress token routes, and local read routes.

---

## Development Overview

Mission Control should standardize route handlers around a small set of contract helpers: read route, mutation route, machine-ingress route, and stream route. The helpers should own JSON parsing, typed error responses, cache headers, auth policy, and consistent response shape while leaving domain logic in `lib/*` modules.

---

## Success Metrics

- New API routes can be created without duplicating JSON parse/error/auth boilerplate.
- Route tests focus on domain behavior and auth policy rather than repeated response construction.
- Existing route response shapes remain compatible unless a route explicitly opts into a versioned change.
- Security-relevant routes declare their auth policy at the route boundary.

---

## Assumptions

- Next.js App Router remains the route runtime.
- Existing routes must remain backward compatible.
- The first migration should be route-by-route and behavior-preserving.

---

## Out of Scope

- Replacing Next.js route handlers.
- Introducing a separate API framework.
- Changing browser auth model.
- Changing all routes in one PR.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Route contract helpers](#route-contract-helpers) | Standardize route boilerplate behind shared helpers. | Extend existing `api-route.ts`. |
| [Explicit auth policy](#explicit-auth-policy) | Route handlers declare read, same-origin, or token auth policy. | Do not infer policy silently. |
| [Incremental migration](#incremental-migration) | Migrate route families one at a time. | Avoid giant route churn. |
| [Compatibility tests](#compatibility-tests) | Preserve response shapes while migrating. | Tests should catch accidental shape drift. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Read route | Browser-readable GET route that may not require a token in the private-network Mission Control model. |
| Mutation route | Browser mutation route protected by same-origin checks. |
| Machine-ingress route | Route intended for producers/webhooks/automation and protected by token auth. |
| Route contract | Shared wrapper that defines auth, body parsing, error, cache, and response behavior. |

---

### Route contract helpers

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a developer, I want a small route wrapper so that route files stay focused on domain calls. | Avoid repeated JSON boilerplate. |
| Proposed | As a maintainer, I want route error responses to be predictable so alerts and UI code can handle them consistently. | Existing shapes should remain compatible. |

---

### Explicit auth policy

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want browser pages to continue working over localhost/Tailscale without unnecessary token prompts. | Preserve current access model. |
| Proposed | As a maintainer, I want mutation and machine-ingress routes to advertise their auth mode in code. | Improve auditability. |

---

### Incremental migration

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a developer, I want route families migrated gradually so each PR is reviewable. | Start with low-risk read routes. |

---

### Compatibility tests

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a maintainer, I want tests to prove route response compatibility after wrapper migration. | Route wrappers should not hide regressions. |

---

## Appendix

### Open Questions And Recommended Answers

1. Should every route use one universal helper?
   Recommended answer: No. Use a small family of helpers for read, mutation, machine-ingress, and stream routes.

2. Should route response shapes be normalized globally?
   Recommended answer: Not in the first pass. Preserve shapes and only standardize mechanics.

3. Should SSE routes use the JSON route helper?
   Recommended answer: No. Give streams their own helper if needed.

### Technical Considerations

- Candidate helper modules: `apps/mission-control/lib/api-route.ts`, `apps/mission-control/lib/api-auth.ts`.
- Candidate early migrations: simple GET routes under `apps/mission-control/app/api/*/route.ts`.
- Avoid migrating high-risk routes such as Codex streams or Trading Ops live streams first.
