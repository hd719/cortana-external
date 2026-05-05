# Implementation Plan - Mission Control Task Source Repository

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control task source repository |
| Tech Spec | [Mission Control Task Source Repository Tech Spec](./techspec-mission-control-task-source-repository.md) |
| PRD | [Mission Control Task Source Repository PRD](./prd-mission-control-task-source-repository.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Repository wrapper | None | Start Now |
| V2 - Task board migration | V1 | Start after V1 |
| V3 - Approvals/feedback/council migration | V1, V2 | Start after V1, V2 |
| V4 - Secondary views and reconciliation | V1, V3 | Start after V1, V3 |
| V5 - Direct-call cleanup | V2, V3, V4 | Start after V2, V3, V4 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3
Sprint 3: V4 + V5
```

---

## Sprint 1 - Repository And Task Board

### Vertical 1 - Repository wrapper

**apps/mission-control: add `task-source-repository.ts` without changing callers**

*Dependencies: None*

#### Jira

- Sub-task 1: Add `apps/mission-control/lib/task-source-repository.ts`.
- Sub-task 2: Keep `apps/mission-control/lib/task-prisma.ts` as the low-level client resolver.
- Sub-task 3: Add `apps/mission-control/lib/task-source-repository.test.ts`.

#### Testing

- Canonical/fallback/unavailable selection covered.
- Mutation default requires canonical source.

---

### Vertical 2 - Task board migration

**apps/mission-control: move task board reads and mutations through the repository**

*Dependencies: V1*

#### Jira

- Sub-task 1: Update `apps/mission-control/lib/task-board-data.ts`.
- Sub-task 2: Update `apps/mission-control/app/api/task-board/route.ts`.
- Sub-task 3: Preserve ready/blocked/due/recent outcome calculations.

#### Testing

- Existing task-board route behavior remains unchanged.
- Fallback source warning is consistently available.

---

## Sprint 2 - Workflow Domains

### Vertical 3 - Approvals/feedback/council migration

**apps/mission-control: migrate major control-plane workflow modules**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Update `apps/mission-control/lib/approvals.ts`.
- Sub-task 2: Update `apps/mission-control/lib/feedback.ts`.
- Sub-task 3: Update `apps/mission-control/lib/council.ts`.
- Sub-task 4: Add mutation tests for canonical-required behavior where needed.

#### Testing

- `approvals.test.ts`, `feedback.test.ts`, and `council.test.ts` pass.
- Mutations do not accidentally write to fallback unless explicitly allowed.

---

## Sprint 3 - Secondary Views And Cleanup

### Vertical 4 - Secondary views and reconciliation

**apps/mission-control: migrate secondary source callers**

*Dependencies: V1, V3*

#### Jira

- Sub-task 1: Update `apps/mission-control/lib/decision-traces.ts`.
- Sub-task 2: Update `apps/mission-control/lib/logs.ts`.
- Sub-task 3: Update `apps/mission-control/lib/agents.ts`.
- Sub-task 4: Update `apps/mission-control/lib/cron-health-data.ts`.
- Sub-task 5: Update `apps/mission-control/lib/task-reconciliation.ts`.

#### Testing

- Existing secondary view tests pass.
- Reconciliation behavior remains unchanged except for centralized source metadata.

---

### Vertical 5 - Direct-call cleanup

**apps/mission-control: audit and remove unnecessary direct `getTaskPrisma()` calls**

*Dependencies: V2, V3, V4*

#### Jira

- Sub-task 1: Run `rg "getTaskPrisma\\(" apps/mission-control`.
- Sub-task 2: Leave direct calls only inside repository/source infrastructure.
- Sub-task 3: Document intentional remaining direct calls.

#### Testing

- `pnpm --filter mission-control test`

---

## Scope Boundaries

### In Scope (This Plan)

- Repository boundary.
- Source metadata.
- Read/write policy.
- Incremental caller migration.

### External Dependencies

- Cortana DB availability.
- Mission Control fallback tables.

### Integration Points

- `apps/mission-control/lib/task-prisma.ts`
- `apps/mission-control/lib/task-board-data.ts`
- `apps/mission-control/lib/approvals.ts`
- `apps/mission-control/lib/feedback.ts`
- `apps/mission-control/lib/council.ts`
- `apps/mission-control/lib/decision-traces.ts`
- `apps/mission-control/lib/task-reconciliation.ts`

---

## Realistic Delivery Notes

- **Smallest credible path:** repository wrapper plus task board migration.
- **Biggest risks:** mutation safety and inconsistent warning metadata.
- **Assumptions:** no schema changes needed.
