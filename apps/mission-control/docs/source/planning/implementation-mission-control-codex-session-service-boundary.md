# Implementation Plan - Mission Control Codex Session Service Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Codex session service boundary |
| Tech Spec | [Mission Control Codex Session Service Boundary Tech Spec](./techspec-mission-control-codex-session-service-boundary.md) |
| PRD | [Mission Control Codex Session Service Boundary PRD](./prd-mission-control-codex-session-service-boundary.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Service wrapper | None | Start Now |
| V2 - Route migration | V1 | Start after V1 |
| V3 - Lifecycle consolidation | V1, V2 | Start after V1, V2 |
| V4 - Test cleanup | V3 | Start after V3 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3 + V4
```

---

## Sprint 1 - Boundary And Routes

### Vertical 1 - Service wrapper

**apps/mission-control: introduce `codex-session-service.ts` as an orchestration boundary**

*Dependencies: None*

#### Jira

- Sub-task 1: Add `apps/mission-control/lib/codex-session-service.ts` with wrapper methods around existing Codex modules.
- Sub-task 2: Add `apps/mission-control/lib/codex-session-service.test.ts` proving wrapper behavior matches existing public functions.
- Sub-task 3: Keep all existing module exports during migration.

#### Testing

- `pnpm --filter mission-control test`
- Service list/detail tests match current visible-session results.

---

### Vertical 2 - Route migration

**apps/mission-control: move Codex session routes onto the service boundary**

*Dependencies: V1*

#### Jira

- Sub-task 1: Update `apps/mission-control/app/api/codex/sessions/route.ts`.
- Sub-task 2: Update `apps/mission-control/app/api/codex/sessions/[sessionId]/route.ts`.
- Sub-task 3: Update `apps/mission-control/app/api/codex/sessions/[sessionId]/messages/route.ts`.
- Sub-task 4: Update `apps/mission-control/app/api/codex/streams/[streamId]/route.ts`.

#### Testing

- Existing Codex API route tests pass unchanged or with only import mocks updated.
- No route response shape changes.

---

## Sprint 2 - Lifecycle And Cleanup

### Vertical 3 - Lifecycle consolidation

**apps/mission-control: centralize archive/delete/reply stream lifecycle through the service**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Route archive/delete calls through the service if any still call lower-level modules directly.
- Sub-task 2: Ensure active run state and mirror reconciliation are invoked consistently after create/reply.
- Sub-task 3: Document source order in comments or docs: active run, mirror, filesystem backfill.

#### Testing

- Active reply stream remains visible after thread selection changes.
- Deleted sessions disappear from visible session list.
- Archived sessions do not reappear from filesystem fallback.

---

### Vertical 4 - Test cleanup

**apps/mission-control: remove redundant helper tests after service coverage exists**

*Dependencies: V3*

#### Jira

- Sub-task 1: Audit `codex-session-access.test.ts`, `codex-sessions.test.ts`, and `codex-runs.test.ts`.
- Sub-task 2: Keep source-adapter tests that cover parsing or source-specific behavior.
- Sub-task 3: Move orchestration assertions into `codex-session-service.test.ts`.

#### Testing

- `pnpm --filter mission-control test`
- Manual `/sessions` check for list, detail, reply, and stream recovery.

---

## Scope Boundaries

### In Scope (This Plan)

- New session service boundary.
- Route migration to the boundary.
- Lifecycle consistency.
- Test migration.

### External Dependencies

- Local Codex state under `~/.codex`.
- Existing Codex CLI/app-server behavior.

### Integration Points

- `apps/mission-control/lib/codex-sessions.ts`
- `apps/mission-control/lib/codex-mirror.ts`
- `apps/mission-control/lib/codex-session-access.ts`
- `apps/mission-control/lib/codex-runs.ts`
- `apps/mission-control/app/api/codex/**`
- `apps/mission-control/app/sessions/**`

---

## Realistic Delivery Notes

- **Smallest credible path:** add the service wrapper and migrate API routes first.
- **Biggest risks:** accidentally changing visibility filters or stream recovery behavior.
- **Assumptions:** existing mirror schema is sufficient.
