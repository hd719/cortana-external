import {
  CodexRunError,
  getActiveCodexSessionIds,
  startCreateCodexRun,
  startReplyCodexRun,
} from "@/lib/codex-runs";
import { renameCodexThread } from "@/lib/codex-app-server";
import { syncCodexMirrorThreadFromSession } from "@/lib/codex-mirror";
import { getVisibleCodexSessionDetail, listVisibleCodexSessions } from "@/lib/codex-session-access";
import { archiveCodexSession, deleteCodexSession, upsertCodexSessionIndexEntry } from "@/lib/codex-sessions";

const DEFAULT_LIMIT = 20;
const DEFAULT_EVENT_PAGE_SIZE = 60;
const MAX_EVENT_PAGE_SIZE = 200;
export const MAX_CODEX_THREAD_NAME_LENGTH = 120;

export type CodexSessionRunRequest = {
  prompt?: string;
  workspaceKey?: string | null;
  model?: string | null;
  imageIds?: string[] | null;
};

export type CodexSessionReplyRequest = {
  prompt?: string;
  model?: string | null;
  imageIds?: string[] | null;
};

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.floor(parsed);
}

function parsePositiveInt(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function requirePrompt(prompt: string | undefined) {
  const trimmed = prompt?.trim();
  if (!trimmed) {
    throw new CodexRunError("invalid_request", "Prompt is required");
  }
  return trimmed;
}

export function normalizeCodexThreadName(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function requireCodexThreadName(value: string | null | undefined) {
  const normalized = normalizeCodexThreadName(value);
  if (!normalized) {
    throw new CodexRunError("invalid_request", "Thread name is required");
  }

  if (typeof value === "string" && value.replace(/\s+/g, " ").trim().length > MAX_CODEX_THREAD_NAME_LENGTH) {
    throw new CodexRunError(
      "invalid_request",
      `Thread name must be ${MAX_CODEX_THREAD_NAME_LENGTH} characters or fewer`,
    );
  }

  return normalized;
}

const withActiveRunState = <T extends { sessionId: string }>(
  session: T,
  activeSessionIds: Set<string>,
) => ({
  ...session,
  activeRun: activeSessionIds.has(session.sessionId),
});

export async function listCodexSessionWorkspace(searchParams: URLSearchParams) {
  const result = await listVisibleCodexSessions(parseLimit(searchParams.get("limit")));
  const activeSessionIds = getActiveCodexSessionIds();

  return {
    ...result,
    sessions: result.sessions.map((session) => withActiveRunState(session, activeSessionIds)),
    groups: result.groups.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => withActiveRunState(session, activeSessionIds)),
    })),
  };
}

export async function getCodexSessionPage(sessionId: string, searchParams: URLSearchParams) {
  const session = await getVisibleCodexSessionDetail(sessionId);
  if (!session) {
    throw new Error(`Codex session ${sessionId} not found`);
  }

  const before = parsePositiveInt(searchParams.get("before"));
  const requestedLimit = parsePositiveInt(searchParams.get("limit"));
  const limit = Math.min(requestedLimit ?? DEFAULT_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE);
  const totalEvents = session.events.length;
  const end = before == null ? totalEvents : Math.min(before, totalEvents);
  const start = Math.max(0, end - limit);
  const events = session.events.slice(start, end);

  return {
    session: { ...session, events },
    pagination: {
      totalEvents,
      loadedEvents: events.length,
      hasMore: start > 0,
      nextBefore: start > 0 ? start : null,
      rangeStart: start,
      rangeEnd: end,
    },
  };
}

export async function createCodexSessionRun(body: CodexSessionRunRequest) {
  const { streamId } = await startCreateCodexRun({
    prompt: requirePrompt(body.prompt),
    workspaceKey: body.workspaceKey,
    model: body.model,
    imageIds: body.imageIds,
  });
  return { streamId };
}

export async function replyToCodexSession(sessionId: string, body: CodexSessionReplyRequest) {
  const { streamId } = await startReplyCodexRun({
    sessionId,
    prompt: requirePrompt(body.prompt),
    model: body.model,
    imageIds: body.imageIds,
  });
  return { streamId };
}

export async function archiveCodexWorkspaceSession(sessionId: string) {
  await archiveCodexSession(sessionId);
  return { ok: true, sessionId, action: "archive" as const };
}

export async function renameCodexWorkspaceSession(sessionId: string, threadName: string | null | undefined) {
  const normalizedThreadName = requireCodexThreadName(threadName);
  const existing = await getVisibleCodexSessionDetail(sessionId);
  if (!existing) {
    throw new CodexRunError("not_found", `Codex session ${sessionId} not found`);
  }

  await renameCodexThread(sessionId, normalizedThreadName);

  const updatedSession = {
    ...existing,
    threadName: normalizedThreadName,
  };

  await Promise.all([
    upsertCodexSessionIndexEntry({
      id: sessionId,
      threadName: normalizedThreadName,
      updatedAt: existing.updatedAt ?? Date.now(),
    }),
    syncCodexMirrorThreadFromSession(updatedSession),
  ]);

  return {
    ok: true,
    sessionId,
    action: "rename" as const,
    session: updatedSession,
  };
}

export async function deleteCodexWorkspaceSession(sessionId: string) {
  await deleteCodexSession(sessionId);
  return { ok: true, sessionId, action: "delete" as const };
}

export function codexRunErrorStatus(error: CodexRunError) {
  if (error.code === "invalid_request") return 400;
  if (error.code === "conflict") return 409;
  if (error.code === "not_found") return 404;
  if (error.code === "prerequisite_failed") return 412;
  return 500;
}
