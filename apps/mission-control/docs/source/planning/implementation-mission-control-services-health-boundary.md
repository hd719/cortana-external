# Implementation Plan - Mission Control Services Health Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control services health boundary |
| Tech Spec | [Mission Control Services Health Boundary Tech Spec](./techspec-mission-control-services-health-boundary.md) |
| PRD | [Mission Control Services Health Boundary PRD](./prd-mission-control-services-health-boundary.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Workspace boundary wrapper | None | Start Now |
| V2 - Provider registry | V1 | Start after V1 |
| V3 - Route migration | V1, V2 | Start after V1, V2 |
| V4 - UI simplification | V3 | Start after V3 |
| V5 - Provider cleanup | V4 | Start after V4 |

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2
Sprint 2: V3 + V4
Sprint 3: V5
```

---

## Sprint 1 - Boundary And Registry

### Vertical 1 - Workspace boundary wrapper

**apps/mission-control: add a boundary without changing service workspace behavior**

*Dependencies: None*

#### Jira

- Sub-task 1: Add `apps/mission-control/lib/services-health-workspace.ts`.
- Sub-task 2: Wrap existing `getServicesWorkspace` and update helpers from `apps/mission-control/lib/service-workspace.ts`.
- Sub-task 3: Add `apps/mission-control/lib/services-health-workspace.test.ts`.

#### Testing

- Existing service workspace tests pass.
- Boundary wrapper returns the same payload as current workspace loader.

---

### Vertical 2 - Provider registry

**apps/mission-control: add adapter registration for service health and actions**

*Dependencies: V1*

#### Jira

- Sub-task 1: Add `apps/mission-control/lib/service-provider-registry.ts`.
- Sub-task 2: Register existing health probes from `apps/mission-control/lib/workspace-health.ts`.
- Sub-task 3: Register actions currently handled by `apps/mission-control/app/api/services/actions/[action]/route.ts`.

#### Testing

- Registry resolves known providers.
- Unknown actions return explicit not-found results.

---

## Sprint 2 - Routes And UI

### Vertical 3 - Route migration

**apps/mission-control: route Services API calls through the boundary**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Update `apps/mission-control/app/api/services/workspace/route.ts`.
- Sub-task 2: Update `apps/mission-control/app/api/services/actions/[action]/route.ts`.
- Sub-task 3: Preserve current auth behavior and route response shapes.

#### Testing

- Existing Services API route tests pass.
- Same-origin patch protection remains enforced.

---

### Vertical 4 - UI simplification

**apps/mission-control: simplify Services UI around prepared provider sections**

*Dependencies: V3*

#### Jira

- Sub-task 1: Update `apps/mission-control/app/services/services-client.tsx` only where prepared model fields remove client-side interpretation.
- Sub-task 2: Keep tabs under `apps/mission-control/app/services/tabs/` focused on rendering.
- Sub-task 3: Avoid visual redesign.

#### Testing

- `apps/mission-control/app/services/services-client.test.tsx` passes.
- Manual `/services` check confirms provider cards and auth action links work.

---

## Sprint 3 - Provider Cleanup

### Vertical 5 - Provider cleanup

**apps/mission-control: move provider-specific logic out of generic workspace code**

*Dependencies: V4*

#### Jira

- Sub-task 1: Audit `apps/mission-control/lib/workspace-health.ts`.
- Sub-task 2: Move provider-specific health checks into adapter functions.
- Sub-task 3: Leave shared normalization helpers in common code.
- Sub-task 4: Document provider adapter requirements.

#### Testing

- `pnpm --filter mission-control test`
- External-service unavailable fixture returns degraded health.

---

## Scope Boundaries

### In Scope (This Plan)

- Services workspace boundary.
- Provider health/action registry.
- Route migration.
- UI simplification around prepared sections.

### External Dependencies

- external-service health/auth endpoints.
- Existing config files and field metadata.

### Integration Points

- `apps/mission-control/lib/service-workspace.ts`
- `apps/mission-control/lib/workspace-health.ts`
- `apps/mission-control/lib/workspace-fields.ts`
- `apps/mission-control/app/api/services/**`
- `apps/mission-control/app/services/**`

---

## Realistic Delivery Notes

- **Smallest credible path:** wrapper boundary plus route migration.
- **Biggest risks:** over-generalizing provider adapters and widening config writes.
- **Assumptions:** no API shape change required.
