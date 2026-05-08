# Implementation Plan - Mission Control Codex Thread Rename

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Codex thread rename |
| Tech Spec | [Mission Control Codex Thread Rename Tech Spec](./techspec-mission-control-codex-thread-rename.md) |
| PRD | [Mission Control Codex Thread Rename PRD](./prd-mission-control-codex-thread-rename.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Server rename mutation | None | Start Now |
| V2 - UI rename controls | V1 API shape | Start after V1 |
| V3 - Tests and QA | V1, V2 | Start after V1, V2 |

---

## Recommended Execution Order

```text
Commit 1: planning docs
Commit 2: server mutation + UI controls + tests
```

---

## Vertical 1 - Server Rename Mutation

**apps/mission-control: add a route-facing Codex thread rename operation**

*Dependencies: None*

### Tasks

- Add manual app-server rename helper in `lib/codex-app-server.ts`.
- Add title normalization/validation and `renameCodexWorkspaceSession` in `lib/codex-session-workspace.ts`.
- Extend `PATCH /api/codex/sessions/[sessionId]` with `action: "rename"`.
- Return updated session detail to the client after a successful rename.

### Verification

- Route test: valid rename returns updated session.
- Route test: empty title returns `400`.
- Route test: missing session returns `404`.

---

## Vertical 2 - UI Rename Controls

**apps/mission-control: expose rename from the sessions list and selected-session inspector**

*Dependencies: V1 API shape*

### Tasks

- Add a rename icon action to each visible session row.
- Add a rename action to the inspector's session actions.
- Add a rename dialog with current title as the initial value.
- On success, reconcile `codexSessions`, `codexSessionGroups`, `selectedCodexSession`, `provisionalCodexSession`, and detail cache.
- Show existing mutation error surface if rename fails.

### Verification

- Client test: click row rename, submit a new name, and confirm PATCH body.
- Client test: renamed title appears in the sidebar/header without page refresh.
- Manual check: cancel leaves title unchanged.

---

## Vertical 3 - Tests And QA

**apps/mission-control: prove the feature and guard existing session operations**

*Dependencies: V1, V2*

### Tasks

- Add focused unit/route tests.
- Run existing `/sessions` client tests.
- Run typecheck for Mission Control.
- If safe, run an end-to-end smoke test against a dev Mission Control instance and restore any temporary title changes.

### Verification Commands

```bash
pnpm --filter mission-control test
pnpm --filter mission-control typecheck
```

---

## Scope Boundaries

### In Scope

- Rename visible Codex sessions.
- Update local Codex title plus Mission Control metadata.
- Route/UI tests and a practical QA plan.

### Out Of Scope

- AI title generation.
- Rename history.
- Mobile-only redesign.
- Changes to Codex transcript storage formats.

---

## Open Questions And Answers

1. Should rename be its own route?
   Answer: no. `PATCH /api/codex/sessions/[sessionId]` already owns session lifecycle mutations, so `action: "rename"` keeps the API coherent.

2. Should the implementation introduce a new database migration?
   Answer: no. Existing mirror metadata already has a thread-name field.

3. Should we block rename during create/reply?
   Answer: only block duplicate rename submissions. Create/reply streams can continue because rename updates metadata, not message execution.
