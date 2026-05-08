# QA Plan - Mission Control Codex Thread Rename

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @cortana-hd |
| Epic | Mission Control Codex thread rename |
| PRD | [Mission Control Codex Thread Rename PRD](./prd-mission-control-codex-thread-rename.md) |
| Tech Spec | [Mission Control Codex Thread Rename Tech Spec](./techspec-mission-control-codex-thread-rename.md) |

---

## QA Goals

- Confirm a visible Codex thread can be renamed from Mission Control.
- Confirm the rename persists through server-backed refresh paths.
- Confirm invalid names fail clearly.
- Confirm archive, delete, create, and reply behavior is not regressed.

---

## Automated Checks

| Area | Check | Expected Result |
|------|-------|-----------------|
| API route | Valid `PATCH` rename request | Returns `ok: true` and updated session title. |
| API route | Empty or whitespace title | Returns `400` and does not call rename service. |
| API route | Unknown session id | Returns `404`. |
| Client UI | Row rename action | Opens dialog with current title. |
| Client UI | Save new title | Sends `action: "rename"` and updates visible title. |
| Client UI | Cancel | Closes dialog with no mutation. |
| Regression | Archive/delete PATCH tests | Existing behavior remains green. |

Recommended commands:

```bash
pnpm --filter mission-control test
pnpm --filter mission-control typecheck
```

---

## Manual QA

1. Open `/sessions`.
2. Pick a non-critical visible Codex thread.
3. Rename it to a short test title.
4. Confirm the sidebar row, page header, and inspector show the new title.
5. Refresh `/sessions` and confirm the title persists.
6. Rename the thread back to its original title.
7. Confirm archive/delete controls still appear and still work on an unrelated test-safe thread if available.

---

## Restart Path

For launchd-managed Mission Control verification, use the canonical restart script:

```bash
apps/mission-control/scripts/restart-mission-control.sh
```

That path rebuilds Mission Control, restarts the launchd-managed service, and waits for the health endpoint. Use an alternate-port server only for isolated PR smoke testing when the live operator session should not be restarted.

---

## End-To-End Smoke Test

If a local Mission Control instance can be restarted safely, use `apps/mission-control/scripts/restart-mission-control.sh` and test against the normal operator URL. If the live operator session should not be restarted, an isolated alternate-port smoke test is acceptable:

1. Start Mission Control on an alternate port, for example `3002`.
2. Fetch `/api/codex/sessions`.
3. Record one visible session's original title.
4. PATCH the session to a temporary title.
5. Fetch detail/list again and assert the temporary title is visible.
6. PATCH the session back to the original title.
7. Fetch detail/list again and assert the original title is restored.

Do not leave test titles in live Codex state.

---

## Release Criteria

- Planning docs committed separately from code.
- Feature commit includes server, API, UI, and tests.
- Automated checks pass locally or any failures are explained with exact commands.
- End-to-end smoke test is completed or skipped with a clear reason.

---

## Open Questions And Answers

1. Is browser automation required for this feature?
   Answer: not required if client tests cover the dialog and mutation path. Browser smoke is useful only if a dev instance can run safely on an alternate port.

2. Should QA mutate Hamel's active thread?
   Answer: avoid the active thread when possible. If no safe thread exists and an end-to-end test is necessary, restore the original title immediately.

3. What is the rollback plan?
   Answer: revert the feature commit. Rename is an additive API/UI action and does not require schema rollback.
