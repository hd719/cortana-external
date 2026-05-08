# Product Requirements Document (PRD) - Mission Control Codex Thread Rename

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @cortana-hd |
| Epic | Mission Control Codex thread rename |

---

## Problem / Opportunity

Mission Control's `/sessions` view shows Codex chat threads, but thread names are currently derived from the original prompt or runtime metadata. Long or similar first prompts make it hard to tell which active thread is the one Hamel wants to continue.

The opportunity is to let the operator rename a Codex thread directly from Mission Control while preserving the existing Codex thread, messages, archive state, delete behavior, and sidebar grouping.

---

## Development Overview

Add a manual rename action to the Codex Sessions UI. The action should update the local Codex thread title through the existing Codex app-server thread-name protocol, reconcile Mission Control's session index/mirror metadata, and refresh the active UI state without requiring a Mission Control restart.

---

## Success Metrics

- A visible Codex thread can be renamed from the `/sessions` sidebar.
- The selected thread title updates immediately after rename.
- The renamed title persists after page refresh.
- Rename does not create a new thread or alter message history.
- Existing archive, delete, pin, create, and reply flows continue to work.

---

## Assumptions

- Mission Control continues to run against local Codex state under `~/.codex`.
- Codex app-server supports `thread/name/set` for existing thread ids.
- A manual title is a local machine concern, not a multi-user shared setting.
- Title validation can be simple: trim whitespace, require non-empty input, and enforce a bounded length.

---

## Out of Scope

- Bulk rename.
- Rename history/audit trail.
- Cross-device synchronization.
- AI-generated title suggestions.
- Renaming archived or deleted threads from hidden views.

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Rename action | Add a visible rename control for each session row and the selected-session inspector. | Keep actions consistent with archive/delete affordances. |
| Rename dialog | Prompt for a new thread name before applying the change. | Input starts with the current title. |
| Server mutation | Add a PATCH action that renames a session by id. | Reuse existing `/api/codex/sessions/[sessionId]` route. |
| Metadata reconciliation | Update Codex title, session index, and Mission Control mirror after success. | Prevent refresh drift. |
| Verification | Cover route behavior, UI behavior, and persistence-sensitive service behavior. | Prefer focused tests plus one end-to-end smoke check if safe. |

---

## User Stories

| Status | User story | Notes |
|--------|------------|-------|
| Proposed | As Hamel, I want to rename a confusing Codex thread so I can quickly find the right conversation later. | Primary operator flow. |
| Proposed | As Hamel, I want the current thread header to update immediately so I know the rename worked. | Avoid cryptic hidden success states. |
| Proposed | As a maintainer, I want rename to use the same lifecycle route family as archive/delete so session mutations stay discoverable. | Keeps API surface small. |

---

## Open Questions And Answers

1. Should rename update the underlying Codex thread title or only Mission Control display metadata?
   Answer: update the underlying Codex thread title through `thread/name/set`, then reconcile Mission Control metadata. A UI-only alias would drift from Codex and become confusing after refresh.

2. Should renaming reorder the thread list?
   Answer: no intentional reorder. Rename is a labeling action, not activity. Preserve the existing `updatedAt` when reconciling metadata unless Codex itself changes it.

3. What should the maximum title length be?
   Answer: 120 characters. It is long enough for useful labels and short enough to fit sidebar and inspector layouts.

4. Should the operator be able to clear a title?
   Answer: no. Empty or whitespace-only titles should return a validation error and keep the current name.

5. Should the UI expose rename for deleted sessions?
   Answer: no. Deleted sessions are outside the visible sessions surface. Archived sessions can keep existing archive behavior; this feature targets visible sessions.
