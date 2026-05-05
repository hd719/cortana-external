# Technical Specification - Mission Control Task Source Repository

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control task source repository |

---

## Development Overview

Introduce a `TaskSourceRepository` boundary that owns Cortana DB versus Mission Control fallback DB selection, warning metadata, read/write methods, and reconciliation hooks for task/control-plane state. Existing domain modules should call the repository instead of calling `getTaskPrisma()` directly.

---

## Data Storage Changes

None expected for the first refactor.

Existing tables and Prisma models remain unchanged. This project changes access patterns, not storage shape.

---

## Infrastructure Changes (if any?)

None.

---

## Behavior Changes

First migration should preserve behavior while making source metadata explicit.

Allowed changes:

- central source warning text
- consistent canonical/fallback/unavailable source metadata
- safer mutation failures when canonical source is required

Disallowed first-pass changes:

- schema changes
- moving task ownership from Cortana to Mission Control
- changing task-board ready/blocked/due calculations

---

## Application/Script Changes

### New module: `apps/mission-control/lib/task-source-repository.ts`

Recommended interface:

```ts
export type TaskSourceKind = "canonical" | "fallback" | "unavailable";

export type TaskSourceContext = {
  kind: TaskSourceKind;
  warning?: string;
  client: typeof prisma | null;
};

export type TaskSourceRepository = {
  getSource(input?: { requireCanonical?: boolean }): TaskSourceContext;
  withRead<T>(operation: (client: typeof prisma, source: TaskSourceContext) => Promise<T>): Promise<{ data: T; source: TaskSourceContext }>;
  withMutation<T>(operation: (client: typeof prisma, source: TaskSourceContext) => Promise<T>, options?: { allowFallback?: boolean }): Promise<{ data: T; source: TaskSourceContext }>;
};
```

### Updated modules

- `apps/mission-control/lib/task-prisma.ts`: becomes low-level source/client resolver.
- `apps/mission-control/lib/task-board-data.ts`: reads through repository.
- `apps/mission-control/lib/approvals.ts`: reads/mutations through repository.
- `apps/mission-control/lib/feedback.ts`: reads/mutations through repository.
- `apps/mission-control/lib/council.ts`: reads/mutations through repository.
- `apps/mission-control/lib/decision-traces.ts`: reads/writes through repository.
- `apps/mission-control/lib/task-reconciliation.ts`: uses repository source metadata.
- `apps/mission-control/lib/task-sync.ts`: remains sync mechanics but should not decide canonical/fallback policy independently.

---

## API Changes

No external route shape changes required initially.

Optional response metadata for future route updates:

```ts
type TaskSourceResponseMeta = {
  source: "canonical" | "fallback" | "unavailable";
  warning?: string;
};
```

Routes that already surface warnings can adopt this metadata first.

---

## Process Changes

- Migrate one domain module at a time.
- Do not remove `getTaskPrisma()` until remaining direct callers are audited.
- Require mutation tests for fallback/canonical behavior.

---

## Orchestration Changes

None.

---

## Test Plan

Add `apps/mission-control/lib/task-source-repository.test.ts` covering:

- canonical source selected when `CORTANA_DATABASE_URL` is configured
- fallback source selected when canonical source is absent and fallback is allowed
- unavailable source reported when neither source is usable
- mutations require canonical source by default
- explicit `allowFallback` permits fallback mutation only when intended

Existing tests to preserve:

- `apps/mission-control/lib/task-reconciliation.test.ts`
- `apps/mission-control/lib/approvals.test.ts`
- `apps/mission-control/lib/feedback.test.ts`
- `apps/mission-control/lib/council.test.ts`
- `apps/mission-control/lib/decision-traces.test.ts`
- `apps/mission-control/app/api/task-board/route.ts` behavior through existing page/API tests

---

## Risks / Open Questions

### Risk: repository becomes too broad

Mitigation: repository owns source policy, not every domain query. Domain modules can still own query-specific mapping.

### Risk: fallback warning churn

Mitigation: introduce metadata first, then update UI wording in separate small PRs.

### Open question: should task listener source selection move here?

Recommended answer: partially. The repository should own source policy, while `task-listener.ts` owns LISTEN/NOTIFY lifecycle.
