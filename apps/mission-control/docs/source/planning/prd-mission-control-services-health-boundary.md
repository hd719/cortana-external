# Product Requirements Document (PRD) - Mission Control Services Health Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control services health boundary |

---

## Problem / Opportunity

Mission Control's Services area combines configuration editing, provider health checks, auth URL actions, workspace field metadata, and operator tabs. The current modules are useful but the ownership boundary is broad and split across `service-workspace`, `workspace-health`, services routes, and React tabs.

The opportunity is to create a Services Health boundary that owns service inventory, health reads, config metadata, and action availability so the UI can render a coherent service workspace without knowing how each provider is probed.

---

## Insights

- `workspace-health.ts` owns many provider-specific health checks and external-service interpretations.
- `service-workspace.ts` combines config file access with health aggregation.
- UI and API routes need consistent answers for provider status, auth actions, configuration fields, and remediation state.

---

## Development Overview

Introduce a `ServicesHealthWorkspace` boundary that returns one read model for service config, provider health, action availability, and warnings. Provider-specific health probes should move behind adapters while `service-workspace.ts` remains responsible for reading/writing supported configuration files.

---

## Success Metrics

- Services UI can render from one server read model.
- Provider-specific probe logic is isolated behind adapters.
- Auth/action routes can reuse the same provider registry as the UI.
- Existing services and workspace-health tests remain green.
- Adding a new service/provider requires registering one adapter instead of editing several unrelated files.

---

## Assumptions

- Mission Control remains the local operator UI for service configuration.
- external-service remains the owner of market-data, health, and provider auth endpoints.
- Configuration file writes remain constrained to known files and fields.
- First pass preserves UI behavior.

---

## Out of Scope

- New provider integrations.
- New secrets storage mechanism.
- Replacing existing config files.
- Redesigning the Services UI.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Service workspace read model](#service-workspace-read-model) | Return config, health, actions, and warnings together. | UI should not assemble provider truth itself. |
| [Provider adapters](#provider-adapters) | Isolate provider-specific health and auth logic. | Keep external-service probing out of generic code. |
| [Safe configuration edits](#safe-configuration-edits) | Preserve known-field editing and same-origin protection. | No arbitrary file writes. |
| [Incremental migration](#incremental-migration) | Keep routes and UI compatible while moving internals. | Start with wrapper boundary. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Service workspace | Mission Control page for provider config, health, and auth operations. |
| Provider adapter | Module that knows how to probe one service and expose actions for it. |
| Workspace read model | Aggregated server payload consumed by `/services`. |

---

### Service workspace read model

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want one services view that agrees on provider health and configuration status. | Avoid split-brain status between tabs. |
| Proposed | As a developer, I want the UI to render prepared service sections instead of probing providers itself. | Keep network/I/O server-side. |

---

### Provider adapters

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a developer, I want each provider probe isolated so adding or changing a provider is local. | Reduce risk in `workspace-health.ts`. |

---

### Safe configuration edits

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want config edits to stay constrained to supported fields. | Preserve safety model. |

---

### Incremental migration

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a maintainer, I want this refactor to start as a wrapper and then absorb provider logic gradually. | Avoid broad Services churn. |

---

## Appendix

### Open Questions And Recommended Answers

1. Should service actions be registered beside health adapters?
   Recommended answer: yes. The UI should discover available auth/action links from the same provider registry.

2. Should config write support become generic?
   Recommended answer: no. Keep writes limited to known fields.

3. Should provider health be cached?
   Recommended answer: not in the first pass unless current probes are too slow. Add caching only with staleness metadata.

### Technical Considerations

- Candidate modules: `apps/mission-control/lib/service-workspace.ts`, `apps/mission-control/lib/workspace-health.ts`, `apps/mission-control/lib/workspace-fields.ts`, `apps/mission-control/app/api/services/workspace/route.ts`, `apps/mission-control/app/api/services/actions/[action]/route.ts`, `apps/mission-control/app/services/services-client.tsx`.
