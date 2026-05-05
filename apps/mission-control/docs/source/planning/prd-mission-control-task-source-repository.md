# Product Requirements Document (PRD) - Mission Control Task Source Repository

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control task source repository |

---

## Problem / Opportunity

Mission Control reads operational task/governance state from either the Cortana database or local Mission Control fallback tables. Today that source-selection logic is spread across task board, approvals, feedback, council, decision traces, logs, activity feed, and status routes.

The opportunity is to introduce one repository boundary for Cortana task/control-plane state so source selection, fallback warnings, and read/write behavior are consistent.

---

## Insights

- `getTaskPrisma()` is called from many modules, which means each caller owns part of the source-selection story.
- Some features are read-only views, while others mutate task/governance tables; the source choice matters more for mutations.
- Operators need to know when Mission Control is showing fallback data instead of canonical Cortana task truth.

---

## Development Overview

Introduce a `TaskSourceRepository` boundary that owns Cortana DB versus Mission Control fallback DB selection, warning metadata, read/write methods, and reconciliation hooks for task/control-plane state. Existing domain modules should call the repository instead of calling `getTaskPrisma()` directly.

---

## Success Metrics

- Most `getTaskPrisma()` calls move into one repository module.
- Route/domain modules receive source metadata instead of constructing fallback warnings locally.
- Mutations have one documented rule for whether they can use fallback tables.
- Existing task board, approvals, feedback, council, and decision-trace tests remain green.

---

## Assumptions

- Cortana DB is canonical when configured and reachable.
- Mission Control fallback tables remain useful for local development and degraded read-only views.
- The first migration does not change schemas.
- Mutations require stricter source handling than reads.

---

## Out of Scope

- Replacing Prisma.
- Moving Cortana task ownership into Mission Control.
- Changing task-board product behavior.
- Adding new task/governance workflow features.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Single source repository](#single-source-repository) | Centralize source selection and Prisma client choice. | Hide `getTaskPrisma()` from most callers. |
| [Explicit source metadata](#explicit-source-metadata) | Return canonical/fallback/source-unavailable metadata. | UI and routes can warn consistently. |
| [Read/write policy](#readwrite-policy) | Define which operations can use fallback. | Mutations need stricter safety. |
| [Incremental migration](#incremental-migration) | Migrate one domain at a time. | Avoid broad control-plane churn. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Canonical task source | Cortana DB tables owned by the command brain. |
| Fallback task source | Mission Control local tables with compatible task/control-plane shapes. |
| Source metadata | Repository-provided details about whether data came from canonical, fallback, or unavailable state. |

---

### Single source repository

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a developer, I want one source repository so that each feature does not implement its own fallback logic. | Reduce drift. |
| Proposed | As an operator, I want task/control-plane views to agree on the current source. | Avoid one page saying healthy while another uses fallback. |

---

### Explicit source metadata

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want fallback data labeled so I know whether I am seeing canonical operational truth. | Especially important for task board and approvals. |

---

### Read/write policy

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a maintainer, I want mutations to fail safely when canonical source is required but unavailable. | Avoid writing to fallback by accident. |

---

### Incremental migration

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a developer, I want to migrate task board first, then approvals/feedback/council, then secondary views. | Start with the highest-traffic source. |

---

## Appendix

### Open Questions And Recommended Answers

1. Should fallback writes be allowed?
   Recommended answer: only when explicitly marked safe. Default mutation policy should require canonical source.

2. Should source metadata be part of every response?
   Recommended answer: yes for pages where fallback changes operator trust; no need for every internal helper.

3. Should reconciliation move into the repository?
   Recommended answer: source choice should move there; long-running listener mechanics can remain in dedicated modules.

### Technical Considerations

- Candidate modules: `apps/mission-control/lib/task-prisma.ts`, `task-board-data.ts`, `approvals.ts`, `feedback.ts`, `council.ts`, `decision-traces.ts`, `task-reconciliation.ts`, `task-sync.ts`, `task-listener.ts`.
