# Technical Specification - Mission Control Codex Thread Rename

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Codex thread rename |

---

## Development Overview

Implement Codex thread rename as a small session lifecycle mutation:

1. UI opens a rename dialog from the session row or selected-session inspector.
2. `PATCH /api/codex/sessions/[sessionId]` receives `{ "action": "rename", "threadName": "..." }`.
3. The server validates and normalizes the title.
4. The Codex app-server `thread/name/set` command updates the source Codex thread title.
5. Mission Control updates its session index and mirror metadata so the next list/detail fetch returns the renamed title.

---

## Data Storage Changes

### Database Changes

No schema changes.

Mission Control already stores mirrored Codex thread metadata. The rename operation should update existing mirror records through current helper functions.

### Filesystem / Runtime State

- `~/.codex/state_*.sqlite`: updated indirectly by Codex app-server `thread/name/set`.
- `~/.codex/session_index.jsonl`: updated through existing session index helper.
- Mission Control mirror DB: updated through existing mirror upsert helper.

---

## API Changes

### [UPDATE] `PATCH /api/codex/sessions/[sessionId]`

Add a `rename` action.

Request:

```json
{
  "action": "rename",
  "threadName": "Mission Control rename work"
}
```

Success response:

```json
{
  "ok": true,
  "sessionId": "thread-id",
  "action": "rename",
  "session": {
    "id": "thread-id",
    "threadName": "Mission Control rename work"
  }
}
```

Validation:

- `threadName` is required for `rename`.
- `threadName.trim()` must be non-empty.
- Whitespace runs collapse to a single space.
- Maximum length is 120 characters.

Errors:

- `400` for invalid names.
- `404` for unknown or invisible sessions.
- `500` for app-server or reconciliation failures.

---

## Application Changes

### `apps/mission-control/lib/codex-app-server.ts`

Add a raw manual rename helper that calls `thread/name/set` without reusing prompt summarization:

```ts
renameThread(threadId: string, name: string): Promise<void>
```

`backfillCodexThreadName` should keep using generated names from prompts.

### `apps/mission-control/lib/codex-session-workspace.ts`

Add `renameCodexWorkspaceSession(sessionId, threadName)` as the route-facing operation. It should:

- verify the session is visible;
- normalize and validate the title;
- call the Codex app-server rename helper;
- update session index and mirror metadata;
- return the updated session detail for immediate UI reconciliation.

### `/sessions` React UI

Add:

- row-level rename icon in `SessionList`;
- selected-session rename action in `Inspector`;
- modal/dialog with a text input and cancel/save actions;
- local state reconciliation so sidebar, selected detail, detail cache, and active title update immediately.

---

## Test Plan

- Route tests for successful rename, invalid names, and not-found behavior.
- Service tests for title normalization and metadata reconciliation.
- Client test for opening the rename dialog and PATCHing the renamed title.
- Regression test that archive/delete PATCH actions still work.

---

## Risks / Open Questions

### Risk: Codex app-server rename succeeds but metadata reconciliation fails

Mitigation: perform reconciliation immediately after app-server success, then return the hydrated session. If reconciliation fails, return an error so the UI can refetch or show failure instead of claiming success.

### Risk: generated title backfill overwrites manual title later

Mitigation: manual rename writes both source Codex title and Mission Control metadata. Existing merge logic should prefer the stronger short manual title over old prompt-derived fallbacks.

### Open question: should save be disabled when the title is unchanged?

Answer: yes. Disable save if normalized input matches the current title, which avoids noisy no-op mutations.
