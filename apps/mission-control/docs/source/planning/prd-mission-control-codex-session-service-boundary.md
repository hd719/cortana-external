# Product Requirements Document (PRD) - Mission Control Codex Session Service Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control Codex session service boundary |

---

## Problem / Opportunity

Mission Control's Codex Sessions surface now spans filesystem transcript discovery, SQLite/local state reads, DB mirroring, visibility filtering, stream/run lifecycle, and React session UI. The capability is valuable, but the ownership boundary is spread across several large `lib/codex-*` modules and page components.

The opportunity is to define one session-service interface that hides local Codex storage details, mirror reconciliation, visibility rules, and run streaming from the route handlers and UI.

---

## Insights

- Codex session behavior is distributed across `codex-sessions.ts`, `codex-mirror.ts`, `codex-session-access.ts`, `codex-runs.ts`, `codex-cli.ts`, and `codex-app-server.ts`.
- Several modules know about the same concepts: visible sessions, transcript detail, filesystem lifecycle, active runs, and mirror records.
- Tests are already strong, so this is a refactor candidate rather than a rewrite candidate.

---

## Development Overview

Introduce a `CodexSessionService` boundary that owns visible-session listing, detail hydration, mirror reconciliation, create/reply run lifecycle, stream lookup, and archive/delete operations. Internals can keep separate adapters for filesystem, DB mirror, Codex CLI/app-server, and active in-memory runs.

---

## Success Metrics

- Route handlers depend on one session service instead of multiple lower-level modules.
- Visibility filtering for sidebar sessions lives in one public service path.
- Session detail hydration has one documented source order: mirror, filesystem backfill, active stream.
- Existing Codex Sessions tests remain green.
- Future session UI changes do not need direct knowledge of raw `.codex` transcript paths or mirror table details.

---

## Assumptions

- Mission Control continues to use local Codex state under `~/.codex`.
- Existing DB mirror migrations remain valid.
- The first refactor should not change session visibility behavior or runtime execution behavior.
- Archive/delete behavior remains local-machine only.

---

## Out of Scope

- New Codex product features.
- Changing Codex CLI/app-server protocols.
- Moving sessions to a remote multi-user store.
- Replacing the existing `/sessions` UI.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Single session service](#single-session-service) | Provide one public service for route handlers and UI data needs. | Hide mirror/filesystem split. |
| [Stable visibility rules](#stable-visibility-rules) | Preserve current visible-session filtering. | No product behavior change. |
| [Explicit lifecycle operations](#explicit-lifecycle-operations) | Centralize create, reply, stream, archive, and delete. | Prevent route-level coupling to internals. |
| [Behavior-preserving tests](#behavior-preserving-tests) | Move coverage toward the service boundary. | Keep existing tests until redundant. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Visible session | A Codex thread that resolves to an operator-relevant workspace and should appear in Mission Control. |
| Mirror | Mission Control DB-backed copy of Codex thread and event metadata. |
| Filesystem source | Raw Codex state under `~/.codex`. |
| Active run | A currently executing create/reply turn with a stream id. |

---

### Single session service

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want session list/detail behavior to stay coherent so that a thread does not appear in one view and disappear in another. | One service should own visibility and hydration. |
| Proposed | As a developer, I want a small service API so that route handlers stay thin. | Route handlers should not coordinate mirror and filesystem sources themselves. |

---

### Stable visibility rules

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want utility, worker, archived, and unrelated threads filtered consistently. | Preserve current filtering semantics. |
| Proposed | As a developer, I want visibility decisions to be testable at one boundary. | Keep UI out of filter logic. |

---

### Explicit lifecycle operations

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As an operator, I want create/reply streams to recover cleanly if I switch sessions or refresh. | Active run state and mirror updates should be coordinated. |
| Proposed | As a developer, I want archive/delete to update filesystem state, mirror state, and UI-visible state through one path. | Avoid partial lifecycle updates. |

---

### Behavior-preserving tests

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As a maintainer, I want existing session behavior covered through the service interface so internals can change. | Replace tests only after boundary coverage exists. |

---

## Appendix

### Open Questions And Recommended Answers

1. Should the service hide both CLI and app-server execution?
   Recommended answer: Yes, callers should ask for create/reply, not choose a transport.

2. Should raw `.codex` files remain visible to route handlers?
   Recommended answer: No. Keep raw file handling inside source adapters.

3. Should session visibility be recomputed in React?
   Recommended answer: No. The server service should return already-visible groups.

### Technical Considerations

- Candidate modules: `apps/mission-control/lib/codex-sessions.ts`, `apps/mission-control/lib/codex-mirror.ts`, `apps/mission-control/lib/codex-session-access.ts`, `apps/mission-control/lib/codex-runs.ts`, `apps/mission-control/lib/codex-cli.ts`, `apps/mission-control/lib/codex-app-server.ts`.
- Candidate UI/API paths: `apps/mission-control/app/sessions/page.tsx`, `apps/mission-control/app/api/codex/sessions/**`, `apps/mission-control/app/api/codex/streams/**`.
