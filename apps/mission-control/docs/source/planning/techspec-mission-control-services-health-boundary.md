# Technical Specification - Mission Control Services Health Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control services health boundary |

---

## Development Overview

Introduce a `ServicesHealthWorkspace` boundary that returns one read model for service config, provider health, action availability, and warnings. Provider-specific health probes should move behind adapters while `service-workspace.ts` remains responsible for reading/writing supported configuration files.

---

## Data Storage Changes

None.

---

## Infrastructure Changes (if any?)

None.

---

## Behavior Changes

First pass should preserve behavior:

- `/services` loads the same workspace data.
- `/api/services/workspace` preserves current response shape unless wrapped compatibly.
- `/api/services/actions/[action]` continues to return supported auth/action URLs.
- Same-origin protection for writes remains in place.

---

## Application/Script Changes

### New module: `apps/mission-control/lib/services-health-workspace.ts`

Recommended interface:

```ts
export type ServicesHealthWorkspace = {
  getWorkspace(): Promise<ServicesWorkspacePayload>;
  updateWorkspace(input: WorkspacePatch): Promise<ServicesWorkspacePayload>;
  runAction(action: string): Promise<ServiceActionResult>;
};
```

### New module: `apps/mission-control/lib/service-provider-registry.ts`

Recommended adapter shape:

```ts
export type ServiceProviderAdapter = {
  key: string;
  label: string;
  health(): Promise<WorkspaceHealthItem>;
  actions?: Array<{
    key: string;
    label: string;
    run(): Promise<ServiceActionResult>;
  }>;
};
```

### Updated modules

- `apps/mission-control/lib/workspace-health.ts`: provider-specific functions become adapters over time.
- `apps/mission-control/lib/service-workspace.ts`: remains file/config workspace layer, called by the new boundary.
- `apps/mission-control/lib/workspace-fields.ts`: remains metadata for supported config fields.
- `apps/mission-control/app/api/services/workspace/route.ts`: call the boundary.
- `apps/mission-control/app/api/services/actions/[action]/route.ts`: call registered provider actions.
- `apps/mission-control/app/services/services-client.tsx`: render the existing payload; later simplify around prepared provider sections.

---

## API Changes

No external route shape change required initially.

Internal API:

| Field | Value |
|-------|-------|
| **API** | `ServicesHealthWorkspace` |
| **Description** | Server-side boundary for service workspace reads, writes, health probes, and provider actions. |

---

## Process Changes

- Start with wrapper boundary.
- Move provider probes one at a time into registry adapters.
- Keep config writes constrained by `workspace-fields.ts`.

---

## Orchestration Changes

None.

---

## Test Plan

Add:

- `apps/mission-control/lib/services-health-workspace.test.ts`
- `apps/mission-control/lib/service-provider-registry.test.ts`

Preserve:

- `apps/mission-control/lib/service-workspace.test.ts`
- `apps/mission-control/lib/workspace-health.test.ts`
- `apps/mission-control/app/api/services/workspace/route.test.ts`
- `apps/mission-control/app/api/services/actions/[action]/route.test.ts`
- `apps/mission-control/app/services/services-client.test.tsx`

Scenarios:

- workspace read returns config fields and health items
- patch validates supported fields and preserves same-origin route protection
- provider action resolves through registry
- unavailable external-service produces degraded health, not a thrown page failure

---

## Risks / Open Questions

### Risk: registry abstracts too early

Mitigation: start by wrapping current provider functions, then extract only where duplication or ownership friction is clear.

### Risk: config writes become too broad

Mitigation: keep writes limited to existing `workspace-fields.ts` metadata.

### Open question: should health probes be parallelized or cached?

Recommended answer: adapters can run in parallel through the boundary; caching should wait until stale metadata is designed.
