# Technical Specification - Mission Control Codex Session Service Boundary

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Codex session service boundary |

---

## Development Overview

Introduce a `CodexSessionService` boundary that owns visible-session listing, detail hydration, mirror reconciliation, create/reply run lifecycle, stream lookup, and archive/delete operations. Internals can keep separate adapters for filesystem, DB mirror, Codex CLI/app-server, and active in-memory runs.

---

## Data Storage Changes

### Database Changes

None expected for the first refactor. Existing Codex mirror and lifecycle migrations should remain the storage layer.

If implementation finds missing indexes or lifecycle fields, propose those separately with concrete query evidence from `apps/mission-control/lib/codex-mirror.ts`.

---

## Infrastructure Changes (if any?)

None.

---

## Behavior Changes

Behavior should be preserved:

- `/sessions` still lists visible workspace-grouped Codex sessions.
- Detail hydration still uses mirrored state and local `.codex` recovery paths.
- Create/reply still produces stream ids and active run state.
- Archive/delete still affects the same local session store behavior.

---

## Application/Script Changes

### New module: `apps/mission-control/lib/codex-session-service.ts`

Recommended public interface:

```ts
export type CodexSessionService = {
  listVisibleSessions(input?: { limit?: number }): Promise<VisibleCodexSessionsResult>;
  getVisibleSessionDetail(sessionId: string): Promise<CodexSessionDetail | null>;
  waitForVisibleSessionDetail(sessionId: string): Promise<CodexSessionDetail | null>;
  startSession(input: StartCreateOptions): Promise<CodexRunRecord>;
  replyToSession(input: StartReplyOptions): Promise<CodexRunRecord>;
  getRun(streamId: string): CodexRunRecord | null;
  archiveSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
};
```

The concrete service should compose existing modules rather than duplicating their logic.

### Updated modules

- `apps/mission-control/lib/codex-session-access.ts`: becomes the visibility/filtering adapter.
- `apps/mission-control/lib/codex-sessions.ts`: becomes the raw filesystem/session-index adapter.
- `apps/mission-control/lib/codex-mirror.ts`: remains the DB mirror adapter.
- `apps/mission-control/lib/codex-runs.ts`: remains active-run and stream lifecycle adapter.
- `apps/mission-control/app/api/codex/sessions/route.ts`: call the service.
- `apps/mission-control/app/api/codex/sessions/[sessionId]/route.ts`: call the service.
- `apps/mission-control/app/api/codex/sessions/[sessionId]/messages/route.ts`: call the service.
- `apps/mission-control/app/api/codex/streams/[streamId]/route.ts`: call the service or active-run adapter through the service.

---

## API Changes

### [UPDATE] Internal Codex session service API

| Field | Value |
|-------|-------|
| **API** | `CodexSessionService` |
| **Description** | Single server-side interface for Codex session listing, detail, runs, stream lookup, and lifecycle actions. |

External route response shapes should not change in the first migration.

---

## Process Changes

- Add service-boundary tests before route rewrites.
- Migrate one route family at a time.
- Do not combine this refactor with UX changes to `/sessions`.

---

## Test Plan

- Add `apps/mission-control/lib/codex-session-service.test.ts`.
- Preserve `apps/mission-control/lib/codex-session-access.test.ts`.
- Preserve `apps/mission-control/lib/codex-sessions.test.ts`.
- Preserve `apps/mission-control/lib/codex-runs.test.ts`.
- Preserve route tests under `apps/mission-control/app/api/codex/**`.
- Preserve `apps/mission-control/app/sessions/page.client.test.tsx`.

Boundary scenarios:

- list visible sessions filters the same rows as today
- detail prefers mirror but can backfill from filesystem
- create/reply returns active run records and stream ids
- archive/delete remove sessions from the visible set
- concurrent replies to the same session are rejected

---

## Risks / Open Questions

### Risk: service becomes a pass-through facade

Mitigation: make it own orchestration and source order, while adapters own source-specific parsing and I/O.

### Risk: active in-memory runs stay too coupled to routes

Mitigation: route handlers should call the service for run lookup and stream state.

### Open question: should CLI and app-server be separate transports?

Recommended answer: yes internally, no externally. The service should expose product operations, not transport choices.
