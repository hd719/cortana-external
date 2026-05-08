"use client";

import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/format-utils";
import { ChatPane } from "./_components/ChatPane";
import { ConfirmDialog } from "./_components/ConfirmDialog";
import { Inspector } from "./_components/Inspector";
import { SessionList } from "./_components/SessionList";
import { Toaster, ToastProvider } from "./_components/Toast";
import { useFocusTrap } from "./_components/useFocusTrap";
import type {
  CodexRunErrorCode,
  CodexMutationKind,
  CodexRunStartResponse,
  CodexSession,
  CodexSessionDetail,
  CodexSessionDetailResponse,
  CodexSessionEvent,
  CodexSessionGroup,
  CodexSessionPagination,
  CodexSessionsResponse,
  CodexStreamEnvelope,
  StreamingCodexEvent,
  WorkspaceOption,
} from "./_components/types";

const CODEX_RECONCILE_INTERVAL_MS = 4_000;
const DEFAULT_CODEX_EVENT_PAGE_SIZE = 60;
const CODEX_DETAIL_CACHE_FRESHNESS_MS = 15_000;
const TRANSCRIPT_SCROLL_TOP_FETCH_THRESHOLD_PX = 72;
const RAIL_COLLAPSED_STORAGE_KEY = "mc-rail-collapsed";
const LAST_OPENED_STORAGE_KEY = "mc-session-last-opened";
const START_WORKSPACE_OPTIONS: WorkspaceOption[] = [
  { key: "cortana-external", label: "cortana-external", cwd: "/Users/hd/Developer/cortana-external" },
  { key: "cortana", label: "cortana", cwd: "/Users/hd/Developer/cortana" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseCodexSseChunk(rawChunk: string): CodexStreamEnvelope | null {
  const normalized = rawChunk.replace(/\r/g, "");
  const lines = normalized.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return null;
  }
}

function getCodexStreamError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const error = data.error;
  if (typeof error === "string" && error.trim().length > 0) return error;
  const message = data.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  return null;
}

function getCodexStreamSession(data: unknown): CodexSessionDetail | null {
  if (!isRecord(data)) return null;
  const session = data.session;
  return isRecord(session) ? (session as CodexSessionDetail) : null;
}

function getLifecycleSessionId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const sessionId = data.codexSessionId;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

function getStreamedAssistantDelta(data: unknown): { id: string; text: string } | null {
  if (!isRecord(data) || data.type !== "item.delta") return null;
  const item = data.item;
  if (!isRecord(item) || item.type !== "agent_message") return null;

  const id = item.id;
  const delta = item.delta;
  if (typeof id !== "string" || id.trim().length === 0) return null;
  if (typeof delta !== "string" || delta.length === 0) return null;

  return { id, text: delta };
}

function getStreamedAssistantCompletion(data: unknown): { id: string; text: string } | null {
  if (!isRecord(data) || data.type !== "item.completed") return null;
  const item = data.item;
  if (!isRecord(item) || item.type !== "agent_message") return null;

  const id = item.id;
  const text = item.text;
  if (typeof id !== "string" || id.trim().length === 0) return null;
  if (typeof text !== "string" || text.trim().length === 0) return null;

  return { id, text };
}

function getStreamedThreadId(data: unknown): string | null {
  if (!isRecord(data) || data.type !== "thread.started") return null;
  const threadId = data.thread_id;
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId : null;
}

function formatTimestamp(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function formatRelativeTimestamp(value: number | null | undefined) {
  if (!value) return "Unknown";

  const diffMs = value - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function getCodexSessionTitle(session: Pick<CodexSession, "threadName" | "sessionId"> | null | undefined) {
  return session?.threadName?.trim() || "Untitled Codex session";
}

function getProvisionalThreadName(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Starting new Codex thread";
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

function formatShortSessionId(value: string | null | undefined) {
  if (!value) return "Unavailable";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

function formatCompactPath(value: string | null | undefined, keepSegments = 3) {
  if (!value) return "Unavailable";

  const normalized = value.trim();
  if (!normalized) return "Unavailable";

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= keepSegments) return normalized;

  return `.../${parts.slice(-keepSegments).join("/")}`;
}

function getWorkspaceOption(workspaceKey: string | null | undefined) {
  return START_WORKSPACE_OPTIONS.find((workspace) => workspace.key === workspaceKey) ?? START_WORKSPACE_OPTIONS[0];
}

function mergeGroupedCodexSessions(
  sessions: CodexSession[],
  fallbackSession: CodexSession,
) {
  const existing = sessions.find((session) => session.sessionId === fallbackSession.sessionId);
  const merged = existing
    ? sessions.map((session) =>
        session.sessionId === fallbackSession.sessionId ? { ...session, ...fallbackSession } : session,
      )
    : [fallbackSession, ...sessions];

  return [...merged].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function mergeCodexSessionGroups(
  groups: CodexSessionGroup[],
  fallbackSession: CodexSession | null | undefined,
) {
  const fallbackCwd = fallbackSession?.cwd;
  if (!fallbackSession || !fallbackCwd) return groups;

  const groupIndex = groups.findIndex((group) =>
    fallbackCwd === group.rootPath || fallbackCwd.startsWith(`${group.rootPath}/`),
  );

  if (groupIndex >= 0) {
    const nextGroups = [...groups];
    nextGroups[groupIndex] = {
      ...nextGroups[groupIndex],
      sessions: mergeGroupedCodexSessions(nextGroups[groupIndex].sessions, fallbackSession),
    };
    return nextGroups;
  }

  const workspace = START_WORKSPACE_OPTIONS.find((option) =>
    fallbackCwd === option.cwd || fallbackCwd.startsWith(`${option.cwd}/`),
  );

  if (!workspace) return groups;

  return [
    {
      id: workspace.cwd,
      label: workspace.label,
      rootPath: workspace.cwd,
      isActive: false,
      isCollapsed: false,
      sessions: [fallbackSession],
    },
    ...groups,
  ];
}

export function mergeCodexSessions(
  sessions: CodexSession[],
  fallbackSession: CodexSession | null | undefined,
) {
  if (!fallbackSession) return sessions;

  const existing = sessions.find((session) => session.sessionId === fallbackSession.sessionId);
  const merged = existing
    ? sessions.map((session) =>
        session.sessionId === fallbackSession.sessionId ? { ...session, ...fallbackSession } : session,
      )
    : [fallbackSession, ...sessions];

  return [...merged].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

export function mergeStreamedAssistantEvents(
  events: StreamingCodexEvent[],
  nextEvent: StreamingCodexEvent,
  mode: "append" | "replace",
) {
  const existing = events.find((event) => event.id === nextEvent.id);
  if (!existing) {
    return [...events, nextEvent];
  }

  return events.map((event) =>
    event.id === nextEvent.id
      ? {
          ...event,
          text: mode === "append" ? `${event.text}${nextEvent.text}` : nextEvent.text,
        }
      : event,
  );
}

export function summarizeCodexSessions(sessions: CodexSession[]) {
  return sessions.reduce(
    (acc, session) => {
      acc.total += 1;
      if (session.updatedAt && (!acc.latestUpdatedAt || session.updatedAt > acc.latestUpdatedAt)) {
        acc.latestUpdatedAt = session.updatedAt;
      }
      if (session.cwd) acc.withCwd += 1;
      if (session.lastMessagePreview) acc.withPreview += 1;
      return acc;
    },
    {
      total: 0,
      latestUpdatedAt: null as number | null,
      withCwd: 0,
      withPreview: 0,
    }
  );
}

const ACTIVE_RUN_REPLY_MESSAGE = "Codex is still finishing the previous reply for this thread.";

export function normalizeCodexMutationError(message: string | null | undefined) {
  const trimmed = message?.trim();
  if (!trimmed) {
    return "Codex could not finish that action.";
  }

  if (/already has an active run/i.test(trimmed)) {
    return ACTIVE_RUN_REPLY_MESSAGE;
  }

  return trimmed;
}

function normalizeReplyComposerError(
  message: string | null | undefined,
  code?: CodexRunErrorCode | null,
) {
  if (code === "conflict") {
    return ACTIVE_RUN_REPLY_MESSAGE;
  }

  return normalizeCodexMutationError(message);
}

function getReplySendError(error: unknown) {
  if (isRecord(error)) {
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof error.error === "string"
          ? error.error
          : null;
    const rawCode = error.code;
    const code: CodexRunErrorCode | null =
      rawCode === "invalid_request"
      || rawCode === "conflict"
      || rawCode === "not_found"
      || rawCode === "prerequisite_failed"
        ? rawCode
        : null;
    return { message, code };
  }

  return {
    message: error instanceof Error ? error.message : null,
    code: null,
  };
}

function createReplySendError(message: string, code?: CodexRunErrorCode | null) {
  const error = new Error(message) as Error & { code?: CodexRunErrorCode | null };
  error.code = code ?? null;
  return error;
}

function mergeOlderCodexSessionEvents(
  existingEvents: CodexSessionEvent[],
  olderEvents: CodexSessionEvent[],
) {
  const byId = new Set(existingEvents.map((event) => event.id));
  return [
    ...olderEvents.filter((event) => !byId.has(event.id)),
    ...existingEvents,
  ];
}

type CachedCodexSessionDetail = {
  session: CodexSessionDetail;
  pagination: CodexSessionPagination | null;
  loadedAt: number;
};

type RenameAction = {
  sessionId: string;
  currentTitle: string;
};

type RenameCodexSessionResponse = {
  session?: CodexSessionDetail;
  error?: string;
};

export default function SessionsPage() {
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const transcriptScrollActionRef = useRef<"bottom" | "preserve" | null>(null);
  const transcriptPrependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const selectedCodexSessionIdRef = useRef<string | null>(null);
  const [codexSessions, setCodexSessions] = useState<CodexSession[]>([]);
  const [codexSessionGroups, setCodexSessionGroups] = useState<CodexSessionGroup[]>([]);
  const [codexVisibleTotal, setCodexVisibleTotal] = useState(0);
  const [codexMatchedTotal, setCodexMatchedTotal] = useState(0);
  const [codexLatestUpdatedAt, setCodexLatestUpdatedAt] = useState<number | null>(null);
  const [selectedCodexSessionId, setSelectedCodexSessionId] = useState<string | null>(null);
  const [selectedCodexSession, setSelectedCodexSession] = useState<CodexSessionDetail | null>(null);
  const [selectedCodexPagination, setSelectedCodexPagination] = useState<CodexSessionPagination | null>(null);
  const [codexSessionDetailCache, setCodexSessionDetailCache] = useState<Record<string, CachedCodexSessionDetail>>({});
  const [provisionalCodexSession, setProvisionalCodexSession] = useState<CodexSession | null>(null);
  const [streamedAssistantEvents, setStreamedAssistantEvents] = useState<StreamingCodexEvent[]>([]);
  const [pendingCodexUserEvent, setPendingCodexUserEvent] = useState<CodexSessionEvent | null>(null);
  const [codexStreamingSessionId, setCodexStreamingSessionId] = useState<string | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [codexDetailLoading, setCodexDetailLoading] = useState(false);
  const [codexOlderLoading, setCodexOlderLoading] = useState(false);
  const [newCodexPrompt, setNewCodexPrompt] = useState("");
  const [newCodexWorkspaceKey, setNewCodexWorkspaceKey] = useState<string>("cortana-external");
  const [replyPrompt, setReplyPrompt] = useState("");
  const [replyComposerError, setReplyComposerError] = useState<string | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [codexMutationPending, setCodexMutationPending] = useState<CodexMutationKind | null>(null);
  const [codexMutationError, setCodexMutationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorVariant, setInspectorVariant] = useState<"session" | "workspace">("session");
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "archive"; sessionId: string }
    | { kind: "delete"; sessionId: string }
    | null
  >(null);
  const [renameAction, setRenameAction] = useState<RenameAction | null>(null);
  const [renameThreadName, setRenameThreadName] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>({});
  const helpDialogRef = useRef<HTMLDivElement | null>(null);
  const renameDialogRef = useRef<HTMLFormElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useFocusTrap(helpDialogRef, shortcutsHelpOpen);
  useFocusTrap(renameDialogRef, renameAction !== null);

  // Hydrate rail collapsed + last-opened maps from localStorage once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedCollapsed = window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY);
      if (storedCollapsed != null) {
        setRailCollapsed(storedCollapsed === "true");
      }
    } catch {
      /* ignore */
    }
    try {
      const storedOpened = window.localStorage.getItem(LAST_OPENED_STORAGE_KEY);
      if (storedOpened) {
        const parsed = JSON.parse(storedOpened);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const filtered: Record<string, number> = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "number" && Number.isFinite(value)) {
              filtered[key] = value;
            }
          }
          setLastOpenedAt(filtered);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistRailCollapsed = (next: boolean) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, next ? "true" : "false");
    } catch {
      /* ignore */
    }
  };

  const persistLastOpened = (next: Record<string, number>) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAST_OPENED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      persistRailCollapsed(next);
      return next;
    });
  }, []);

  const handleSelectCodexSession = useCallback((sessionId: string | null) => {
    setSelectedCodexSessionId(sessionId);
    setReplyComposerError(null);
    if (!sessionId) {
      setSelectedCodexSession(null);
      setSelectedCodexPagination(null);
    } else {
      const cached = codexSessionDetailCache[sessionId];
      setSelectedCodexSession(cached?.session ?? null);
      setSelectedCodexPagination(cached?.pagination ?? null);
    }
    if (sessionId) {
      setLastOpenedAt((current) => {
        const next = { ...current, [sessionId]: Date.now() };
        persistLastOpened(next);
        return next;
      });
    }
  }, [codexSessionDetailCache]);

  useEffect(() => {
    selectedCodexSessionIdRef.current = selectedCodexSessionId;
  }, [selectedCodexSessionId]);

  useEffect(() => {
    if (!renameAction) return;

    const focusTimer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 10);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRenameAction(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [renameAction]);

  async function fetchCodexSessions() {
    const response = await fetch("/api/codex/sessions", { cache: "no-store" });
    const payload = (await response.json()) as CodexSessionsResponse;

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load Codex sessions");
    }

    return payload;
  }

  async function loadCodexSessionDetail(
    sessionId: string,
    options: { background?: boolean; before?: number | null; appendMode?: "replace" | "prepend" } = {},
  ) {
    const appendMode = options.appendMode ?? "replace";
    const query = new URLSearchParams({
      limit: String(DEFAULT_CODEX_EVENT_PAGE_SIZE),
    });
    if (options.before != null) {
      query.set("before", String(options.before));
    }

    if (appendMode === "prepend") {
      setCodexOlderLoading(true);
    } else if (!options.background) {
      setCodexDetailLoading(true);
    }

    try {
      const response = await fetch(`/api/codex/sessions/${sessionId}?${query.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as CodexSessionDetailResponse;

      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to load Codex transcript");
      }

      if (appendMode === "prepend") {
        if (selectedCodexSessionIdRef.current !== sessionId) {
          return;
        }

        const currentSession = selectedCodexSessionIdRef.current === sessionId
          ? selectedCodexSession
          : null;
        const mergedSession = currentSession
          ? {
              ...payload.session,
              events: mergeOlderCodexSessionEvents(currentSession.events, payload.session.events),
            }
          : payload.session;

        storeCodexSessionDetail(mergedSession, payload.pagination ?? null);
        startTransition(() => {
          setSelectedCodexSession(mergedSession);
          setSelectedCodexPagination(payload.pagination ?? null);
        });
      } else {
        storeCodexSessionDetail(payload.session, payload.pagination ?? null);
        if (selectedCodexSessionIdRef.current !== sessionId) {
          return;
        }

        transcriptScrollActionRef.current = "bottom";
        setSelectedCodexSession(payload.session);
        setSelectedCodexPagination(payload.pagination ?? null);
      }
      setCodexMutationError(null);
    } catch (err) {
      if (appendMode === "prepend") {
        if (selectedCodexSessionIdRef.current === sessionId) {
          transcriptPrependAnchorRef.current = null;
          transcriptScrollActionRef.current = null;
        }
      } else if (selectedCodexSessionIdRef.current === sessionId) {
        setSelectedCodexSession(null);
        setSelectedCodexPagination(null);
      } else {
        transcriptPrependAnchorRef.current = null;
        transcriptScrollActionRef.current = null;
      }
      setCodexMutationError(err instanceof Error ? err.message : "Failed to load Codex transcript");
    } finally {
      if (appendMode === "prepend") {
        setCodexOlderLoading(false);
      } else if (!options.background) {
        setCodexDetailLoading(false);
      }
    }
  }

  const storeCodexSessionDetail = useCallback((
    session: CodexSessionDetail,
    pagination: CodexSessionPagination | null,
  ) => {
    setCodexSessionDetailCache((current) => ({
      ...current,
      [session.sessionId]: {
        session,
        pagination,
        loadedAt: Date.now(),
      },
    }));
  }, []);

  async function refreshCodexSessions(
    preferredSessionId?: string | null,
    fallbackSession?: CodexSession | null,
  ) {
    const payload = await fetchCodexSessions();
    const preferredFallback =
      fallbackSession
      ?? (preferredSessionId && selectedCodexSession?.sessionId === preferredSessionId ? selectedCodexSession : null)
      ?? (preferredSessionId && provisionalCodexSession?.sessionId === preferredSessionId ? provisionalCodexSession : null);
    const payloadHasPreferredSession =
      Boolean(preferredSessionId)
      && (payload.sessions ?? []).some((session) => session.sessionId === preferredSessionId);
    const sessions = mergeCodexSessions(payload.sessions ?? [], preferredFallback);
    const groups = payloadHasPreferredSession
      ? (payload.groups ?? [])
      : mergeCodexSessionGroups(payload.groups ?? [], preferredFallback);

    setCodexSessions(sessions);
    setCodexSessionGroups(groups);
    setCodexVisibleTotal(Math.max(payload.totalVisibleSessions ?? 0, sessions.length));
    setCodexMatchedTotal(Math.max(payload.totalMatchedSessions ?? 0, sessions.length));
    setCodexLatestUpdatedAt(payload.latestUpdatedAt ?? null);
    setCodexError(null);

    if (payloadHasPreferredSession && provisionalCodexSession?.sessionId === preferredSessionId) {
      setProvisionalCodexSession(null);
    }

    const nextSelected =
      preferredSessionId && sessions.some((session) => session.sessionId === preferredSessionId)
        ? preferredSessionId
        : sessions[0]?.sessionId ?? preferredSessionId ?? null;

    setSelectedCodexSessionId(nextSelected);
    return { sessions, selectedSessionId: nextSelected };
  }

  async function consumeCodexStream(
    response: Response,
    onDone: (session: CodexSessionDetail) => Promise<void>,
    options?: {
      onThreadStarted?: (threadId: string) => void;
    },
  ) {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Codex stream response did not include a body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    const handleChunk = async (rawChunk: string) => {
      const envelope = parseCodexSseChunk(rawChunk);
      if (!envelope) return;

      if (envelope.event === "codex_event") {
        const threadId = getStreamedThreadId(envelope.data);
        if (threadId) {
          options?.onThreadStarted?.(threadId);
        }

        const delta = getStreamedAssistantDelta(envelope.data);
        if (delta) {
          setStreamedAssistantEvents((events) =>
            mergeStreamedAssistantEvents(
              events,
              {
                id: delta.id,
                role: "assistant",
                text: delta.text,
              },
              "append",
            ),
          );
          return;
        }

        const completion = getStreamedAssistantCompletion(envelope.data);
        if (completion) {
          setStreamedAssistantEvents((events) =>
            mergeStreamedAssistantEvents(
              events,
              {
                id: completion.id,
                role: "assistant",
                text: completion.text,
              },
              "replace",
            ),
          );
        }
        return;
      }

      if (envelope.event === "lifecycle") {
        const threadId = getLifecycleSessionId(envelope.data);
        if (threadId) {
          options?.onThreadStarted?.(threadId);
        }
        return;
      }

      if (envelope.event === "error") {
        throw new Error(getCodexStreamError(envelope.data) ?? "Codex stream failed");
      }

      if (envelope.event === "done") {
        const session = getCodexStreamSession(envelope.data);
        if (!session) {
          throw new Error("Codex stream completed without session detail");
        }

        completed = true;
        await onDone(session);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex !== -1) {
        const rawChunk = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        await handleChunk(rawChunk);
        boundaryIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      await handleChunk(buffer);
    }

    if (!completed) {
      throw new Error("Codex stream ended before the session finished");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const codexResult = await fetchCodexSessions()
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason }));

      if (cancelled) return;

      if (codexResult.status === "fulfilled") {
        try {
          setCodexSessions(codexResult.value.sessions ?? []);
          setCodexSessionGroups(codexResult.value.groups ?? []);
          setCodexVisibleTotal(codexResult.value.totalVisibleSessions ?? codexResult.value.sessions.length ?? 0);
          setCodexMatchedTotal(codexResult.value.totalMatchedSessions ?? codexResult.value.sessions.length ?? 0);
          setCodexLatestUpdatedAt(codexResult.value.latestUpdatedAt ?? null);
          setSelectedCodexSessionId(codexResult.value.sessions[0]?.sessionId ?? null);
        } catch (err) {
          setCodexError(err instanceof Error ? err.message : "Failed to load Codex sessions");
        }
      } else {
        setCodexError(codexResult.reason instanceof Error ? codexResult.reason.message : "Failed to load Codex sessions");
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCodexSessionCacheEntry =
    selectedCodexSessionId ? (codexSessionDetailCache[selectedCodexSessionId] ?? null) : null;

  useEffect(() => {
    if (!selectedCodexSessionId) {
      setSelectedCodexSession(null);
      setSelectedCodexPagination(null);
      setReplyComposerError(null);
      return;
    }

    const cached = selectedCodexSessionCacheEntry;
    if (cached) {
      setSelectedCodexSession(cached.session);
      setSelectedCodexPagination(cached.pagination);

      if (Date.now() - cached.loadedAt <= CODEX_DETAIL_CACHE_FRESHNESS_MS) {
        setCodexDetailLoading(false);
        return;
      }

      void loadCodexSessionDetail(selectedCodexSessionId, { background: true });
      return;
    }

    setSelectedCodexSession(null);
    setSelectedCodexPagination(null);
    void loadCodexSessionDetail(selectedCodexSessionId);
  // loadCodexSessionDetail intentionally closes over current selected session state for prepend merges.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodexSessionId, selectedCodexSessionCacheEntry]);

  useEffect(() => {
    if (selectedCodexSessionId) {
      setMobileRailOpen(false);
    }
  }, [selectedCodexSessionId]);

  const reconcileCodexSessions = useEffectEvent(async (isCancelled: () => boolean) => {
    if (isCancelled() || document.visibilityState === "hidden") {
      return;
    }

    try {
      const previousSelectedSessionId = selectedCodexSessionId;
      const { selectedSessionId } = await refreshCodexSessions(previousSelectedSessionId);
      if (isCancelled()) return;

      if (previousSelectedSessionId && previousSelectedSessionId !== selectedSessionId) {
        setSelectedCodexSession(null);
        setPendingCodexUserEvent(null);
        setStreamedAssistantEvents([]);
        setCodexMutationError("Selected Codex thread was archived or removed outside Mission Control.");
      }
    } catch (err) {
      if (!isCancelled()) {
        setCodexError(err instanceof Error ? err.message : "Failed to reconcile Codex sessions");
      }
    }
  });

  useEffect(() => {
    if (loading || codexMutationPending) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    const runReconciliation = () => {
      void reconcileCodexSessions(isCancelled);
    };

    const intervalId = window.setInterval(() => {
      runReconciliation();
    }, CODEX_RECONCILE_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runReconciliation();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loading, codexMutationPending]);

  const loadOlderCodexEvents = useEffectEvent(async () => {
    if (!selectedCodexSessionId || !selectedCodexPagination?.hasMore || selectedCodexPagination.nextBefore == null) {
      return;
    }

    const viewport = transcriptViewportRef.current;
    if (viewport) {
      transcriptPrependAnchorRef.current = {
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
      transcriptScrollActionRef.current = "preserve";
    }

    await loadCodexSessionDetail(selectedCodexSessionId, {
      background: true,
      before: selectedCodexPagination.nextBefore,
      appendMode: "prepend",
    });
  });

  useEffect(() => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      if (
        viewport.scrollTop <= TRANSCRIPT_SCROLL_TOP_FETCH_THRESHOLD_PX
        && selectedCodexPagination?.hasMore
        && !codexOlderLoading
        && !codexDetailLoading
        && !codexMutationPending
      ) {
        void loadOlderCodexEvents();
      }
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [selectedCodexPagination?.hasMore, codexOlderLoading, codexDetailLoading, codexMutationPending]);

  useEffect(() => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) return;

    if (transcriptScrollActionRef.current === "preserve") {
      const anchor = transcriptPrependAnchorRef.current;
      transcriptPrependAnchorRef.current = null;
      transcriptScrollActionRef.current = null;
      if (anchor) {
        viewport.scrollTop = viewport.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      }
      return;
    }

    if (transcriptScrollActionRef.current === "bottom") {
      transcriptScrollActionRef.current = null;
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [
    selectedCodexSessionId,
    selectedCodexSession?.events.length,
    streamedAssistantEvents.length,
    pendingCodexUserEvent?.id,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        (target instanceof HTMLElement && target.isContentEditable);

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;

      if (mod && !event.shiftKey && !event.altKey && key.toLowerCase() === "k") {
        event.preventDefault();
        setFocusSearchSignal((current) => current + 1);
        return;
      }

      if (mod && !event.shiftKey && !event.altKey && key === "\\") {
        event.preventDefault();
        toggleRailCollapsed();
        return;
      }

      if (mod && !event.shiftKey && !event.altKey && key.toLowerCase() === "n") {
        event.preventDefault();
        setNewThreadOpen(true);
        return;
      }

      if (!mod && !event.altKey && !event.shiftKey && key === "?" && !isEditable) {
        event.preventDefault();
        setShortcutsHelpOpen(true);
        return;
      }

      if (key === "Escape" && shortcutsHelpOpen) {
        event.preventDefault();
        setShortcutsHelpOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleRailCollapsed, shortcutsHelpOpen]);

  const visibleCodexSessions = useMemo(
    () => mergeCodexSessions(codexSessions, provisionalCodexSession),
    [codexSessions, provisionalCodexSession],
  );
  const codexSummary = useMemo(() => summarizeCodexSessions(visibleCodexSessions), [visibleCodexSessions]);
  const activeCodexThreadId = selectedCodexSessionId ?? provisionalCodexSession?.sessionId ?? null;
  const activeCodexStreamingThread =
    (selectedCodexSessionId && codexStreamingSessionId === selectedCodexSessionId)
    || (codexMutationPending === "create" && selectedCodexSessionId == null);
  const visiblePendingCodexUserEvent = activeCodexStreamingThread ? pendingCodexUserEvent : null;
  const visibleStreamedAssistantEvents = activeCodexStreamingThread ? streamedAssistantEvents : [];
  const hasCodexTranscriptContent =
    Boolean(selectedCodexSession) ||
    Boolean(provisionalCodexSession) ||
    Boolean(visiblePendingCodexUserEvent) ||
    visibleStreamedAssistantEvents.length > 0;
  const activeCodexSummary =
    activeCodexThreadId
      ? visibleCodexSessions.find((session) => session.sessionId === activeCodexThreadId) ?? null
      : provisionalCodexSession;
  const activeSessionHasRunInProgress =
    Boolean(activeCodexSummary?.activeRun)
    || (codexMutationPending === "reply" && Boolean(selectedCodexSessionId && codexStreamingSessionId === selectedCodexSessionId));
  const activeCodexSession = selectedCodexSession ?? activeCodexSummary ?? provisionalCodexSession;
  const activeCodexTitle =
    selectedCodexSession?.threadName ??
    activeCodexSummary?.threadName ??
    (codexMutationPending === "create" ? "Starting new Codex thread" : "Codex workspace");
  const activeCodexMessageCount = formatInt(
    selectedCodexPagination?.totalEvents ?? selectedCodexSession?.events.length ?? 0,
  );
  const totalVisibleForHeader = codexVisibleTotal || visibleCodexSessions.length;
  const workspaceLabel =
    getWorkspaceOption(selectedCodexSession?.cwd || activeCodexSession?.cwd
      ? START_WORKSPACE_OPTIONS.find((workspace) =>
          (selectedCodexSession?.cwd ?? activeCodexSession?.cwd ?? "")?.startsWith(workspace.cwd),
        )?.key
      : null).label;
  const selectedCreateWorkspace = getWorkspaceOption(newCodexWorkspaceKey);
  const canOpenInfo = Boolean(activeCodexSession) || activeCodexSession == null;
  const normalizedRenameThreadName = renameThreadName.replace(/\s+/g, " ").trim();
  const renameUnchanged =
    Boolean(renameAction) && normalizedRenameThreadName === renameAction?.currentTitle;
  const renameDisabled =
    codexMutationPending === "rename" ||
    !normalizedRenameThreadName ||
    renameUnchanged;

  function applyRenamedCodexSession(sessionId: string, renamedSession: CodexSession | CodexSessionDetail) {
    const patch = {
      ...renamedSession,
      threadName: renamedSession.threadName,
    };

    setCodexSessions((current) =>
      current.map((session) =>
        session.sessionId === sessionId ? { ...session, ...patch } : session,
      ),
    );
    setCodexSessionGroups((current) =>
      current.map((group) => ({
        ...group,
        sessions: group.sessions.map((session) =>
          session.sessionId === sessionId ? { ...session, ...patch } : session,
        ),
      })),
    );
    setSelectedCodexSession((current) =>
      current?.sessionId === sessionId ? { ...current, ...patch } : current,
    );
    setProvisionalCodexSession((current) =>
      current?.sessionId === sessionId ? { ...current, ...patch } : current,
    );
    setCodexSessionDetailCache((current) => {
      const cached = current[sessionId];
      if (!cached) return current;
      return {
        ...current,
        [sessionId]: {
          ...cached,
          session: {
            ...cached.session,
            ...patch,
          },
          loadedAt: Date.now(),
        },
      };
    });
  }

  async function handleCreateCodexSession() {
    const prompt = newCodexPrompt.trim();
    if (!prompt) return;

    const workspace = getWorkspaceOption(newCodexWorkspaceKey);

    transcriptScrollActionRef.current = "bottom";
    setCodexMutationPending("create");
    setCodexMutationError(null);
    setSelectedCodexSessionId(null);
    setSelectedCodexSession(null);
    setSelectedCodexPagination(null);
    setProvisionalCodexSession(null);
    setPendingCodexUserEvent({
      id: `pending-create-${Date.now()}`,
      role: "user",
      text: prompt,
      timestamp: Date.now(),
      phase: "submitted",
      rawType: "user.pending",
    });
    setCodexStreamingSessionId(null);
    setStreamedAssistantEvents([]);
    setNewThreadOpen(false);
    try {
      const startResponse = await fetch("/api/codex/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, workspaceKey: workspace.key }),
      });

      const startPayload = (await startResponse.json()) as CodexRunStartResponse;
      if (!startResponse.ok || !startPayload.streamId) {
        const payload = startPayload as CodexSessionDetailResponse & CodexRunStartResponse;
        throw new Error(payload.error ?? "Failed to create Codex session");
      }

      const response = await fetch(`/api/codex/streams/${startPayload.streamId}`, {
        headers: {
          Accept: "text/event-stream",
        },
      });

      if (!response.ok) {
        const payload = (await response.json()) as CodexRunStartResponse;
        throw new Error(payload.error ?? "Failed to attach to Codex stream");
      }

      await consumeCodexStream(
        response,
        async (session) => {
          const pagination = {
            totalEvents: session.events.length,
            loadedEvents: session.events.length,
            hasMore: false,
            nextBefore: null,
            rangeStart: 0,
            rangeEnd: session.events.length,
          };
          const selectedSessionId = selectedCodexSessionIdRef.current;
          const shouldRevealCompletedSession =
            selectedSessionId == null || selectedSessionId === session.sessionId;

          storeCodexSessionDetail(session, pagination);
          transcriptScrollActionRef.current = "bottom";
          if (shouldRevealCompletedSession) {
            setSelectedCodexSession(session);
            setSelectedCodexPagination(pagination);
          }
          const refreshTargetSessionId = shouldRevealCompletedSession ? session.sessionId : selectedSessionId;
          const { selectedSessionId: nextSelectedSessionId } = await refreshCodexSessions(
            refreshTargetSessionId,
            shouldRevealCompletedSession ? session : null,
          );
          setProvisionalCodexSession(null);
          if (shouldRevealCompletedSession) {
            setSelectedCodexSessionId(nextSelectedSessionId ?? session.sessionId);
          }
          setPendingCodexUserEvent(null);
          setCodexStreamingSessionId(null);
          setStreamedAssistantEvents([]);
        },
        {
          onThreadStarted: (threadId) => {
            setCodexStreamingSessionId(threadId);
            setProvisionalCodexSession((current) => {
              if (current?.sessionId === threadId) return current;
              return {
                sessionId: threadId,
                threadName: getProvisionalThreadName(prompt),
                updatedAt: Date.now(),
                cwd: workspace.cwd,
                model: null,
                source: "exec",
                cliVersion: null,
                lastMessagePreview: prompt,
                transcriptPath: null,
              };
            });
          },
        },
      );
      setNewCodexPrompt("");
    } catch (err) {
      setProvisionalCodexSession(null);
      setPendingCodexUserEvent(null);
      setCodexStreamingSessionId(null);
      setStreamedAssistantEvents([]);
      setCodexMutationError(err instanceof Error ? err.message : "Failed to create Codex session");
    } finally {
      setCodexMutationPending(null);
    }
  }

  async function handleReplyToCodexSession() {
    if (!selectedCodexSessionId || codexMutationPending === "reply") return;
    const submittedSessionId = selectedCodexSessionId;
    const submittedPrompt = replyPrompt;
    const prompt = submittedPrompt.trim();
    if (!prompt) return;
    let replyAccepted = false;
    let streamCompleted = false;

    transcriptScrollActionRef.current = "bottom";
    setCodexMutationPending("reply");
    setCodexMutationError(null);
    setReplyComposerError(null);
    setReplyPrompt("");
    setStreamedAssistantEvents([]);
    setPendingCodexUserEvent({
      id: `pending-reply-${Date.now()}`,
      role: "user",
      text: prompt,
      timestamp: Date.now(),
      phase: "submitted",
      rawType: "user.pending",
    });
    setCodexStreamingSessionId(submittedSessionId);
    try {
      const startResponse = await fetch(`/api/codex/sessions/${submittedSessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const startPayload = (await startResponse.json()) as CodexRunStartResponse;
      if (!startResponse.ok || !startPayload.streamId) {
        throw createReplySendError(
          startPayload.error ?? "Failed to send message to Codex session",
          startPayload.code ?? null,
        );
      }
      replyAccepted = true;

      const response = await fetch(`/api/codex/streams/${startPayload.streamId}`, {
        headers: {
          Accept: "text/event-stream",
        },
      });

      if (!response.ok) {
        const payload = (await response.json()) as CodexRunStartResponse;
        throw createReplySendError(
          payload.error ?? "Failed to attach to Codex stream",
          payload.code ?? null,
        );
      }

      await consumeCodexStream(response, async (session) => {
        streamCompleted = true;
        const pagination = {
          totalEvents: session.events.length,
          loadedEvents: session.events.length,
          hasMore: false,
          nextBefore: null,
          rangeStart: 0,
          rangeEnd: session.events.length,
        };
        const selectedSessionId = selectedCodexSessionIdRef.current;
        const shouldRevealCompletedSession =
          selectedSessionId == null || selectedSessionId === session.sessionId;

        storeCodexSessionDetail(session, pagination);
        transcriptScrollActionRef.current = "bottom";
        if (shouldRevealCompletedSession) {
          setSelectedCodexSession(session);
          setSelectedCodexPagination(pagination);
        }
        setPendingCodexUserEvent(null);
        setCodexStreamingSessionId(null);
        setStreamedAssistantEvents([]);
        setReplyComposerError(null);
        const refreshTargetSessionId = shouldRevealCompletedSession ? session.sessionId : selectedSessionId;
        await refreshCodexSessions(
          refreshTargetSessionId,
          shouldRevealCompletedSession ? session : null,
        );
      });
    } catch (err) {
      if (streamCompleted) {
        return;
      }

      const { message, code } = getReplySendError(err);
      const normalizedMessage = normalizeReplyComposerError(
        message ?? "Failed to send message to Codex session",
        code,
      );

      if (!replyAccepted) {
        setPendingCodexUserEvent(null);
        setCodexStreamingSessionId(null);
        setReplyPrompt(submittedPrompt);
        setStreamedAssistantEvents([]);
        setReplyComposerError(normalizedMessage);

        if (code === "conflict") {
          await refreshCodexSessions(submittedSessionId).catch(() => undefined);
        }
        return;
      }

      setCodexMutationError(normalizedMessage);
    } finally {
      if (!streamCompleted) {
        setCodexStreamingSessionId((current) => (current === submittedSessionId ? null : current));
      }
      setCodexMutationPending(null);
    }
  }

  const handleReplyPromptChange = useCallback((value: string) => {
    setReplyPrompt(value);
    if (replyComposerError) {
      setReplyComposerError(null);
    }
  }, [replyComposerError]);

  async function handleCopySessionId() {
    const sessionId = activeCodexSession?.sessionId;
    if (!sessionId || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedSessionId(sessionId);
      window.setTimeout(() => {
        setCopiedSessionId((current) => (current === sessionId ? null : current));
      }, 1800);
    } catch {
      setCodexMutationError("Failed to copy the Codex session id.");
    }
  }

  async function archiveCodexSessionById(sessionId: string) {
    if (!sessionId) return;

    setCodexMutationPending("archive");
    setCodexMutationError(null);
    try {
      const response = await fetch(`/api/codex/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "archive" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to archive Codex session");
      }

      if (sessionId === selectedCodexSessionId || sessionId === activeCodexSession?.sessionId) {
        setSelectedCodexSessionId(null);
        setSelectedCodexSession(null);
        setSelectedCodexPagination(null);
        setPendingCodexUserEvent(null);
        setCodexStreamingSessionId(null);
        setStreamedAssistantEvents([]);
      }
      setCodexSessionDetailCache((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      await refreshCodexSessions(null);
    } catch (err) {
      setCodexMutationError(err instanceof Error ? err.message : "Failed to archive Codex session");
    } finally {
      setCodexMutationPending(null);
    }
  }

  async function deleteCodexSessionById(sessionId: string) {
    if (!sessionId) return;

    setCodexMutationPending("delete");
    setCodexMutationError(null);
    try {
      const response = await fetch(`/api/codex/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete Codex session");
      }

      if (sessionId === selectedCodexSessionId || sessionId === activeCodexSession?.sessionId) {
        setSelectedCodexSessionId(null);
        setSelectedCodexSession(null);
        setSelectedCodexPagination(null);
        setPendingCodexUserEvent(null);
        setCodexStreamingSessionId(null);
        setStreamedAssistantEvents([]);
      }
      setCodexSessionDetailCache((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      await refreshCodexSessions(null);
    } catch (err) {
      setCodexMutationError(err instanceof Error ? err.message : "Failed to delete Codex session");
    } finally {
      setCodexMutationPending(null);
    }
  }

  function requestRenameSession(session: CodexSession | CodexSessionDetail | null | undefined) {
    if (!session?.sessionId) return;
    const currentTitle = getCodexSessionTitle(session);
    setRenameAction({ sessionId: session.sessionId, currentTitle });
    setRenameThreadName(currentTitle);
    setCodexMutationError(null);
  }

  async function renameCodexSessionById(sessionId: string, threadName: string) {
    if (!sessionId) return;

    const normalizedThreadName = threadName.replace(/\s+/g, " ").trim();
    if (!normalizedThreadName) {
      setCodexMutationError("Thread name is required");
      return;
    }

    setCodexMutationPending("rename");
    setCodexMutationError(null);
    try {
      const response = await fetch(`/api/codex/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "rename", threadName: normalizedThreadName }),
      });
      const payload = (await response.json()) as RenameCodexSessionResponse;
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to rename Codex session");
      }

      applyRenamedCodexSession(sessionId, payload.session);
      setRenameAction(null);
      await refreshCodexSessions(sessionId, payload.session);
    } catch (err) {
      setCodexMutationError(err instanceof Error ? err.message : "Failed to rename Codex session");
    } finally {
      setCodexMutationPending(null);
    }
  }

  function handleArchiveActiveSession() {
    const sessionId = activeCodexSession?.sessionId;
    if (!sessionId) return;
    setConfirmAction({ kind: "archive", sessionId });
  }

  function handleDeleteActiveSession() {
    const sessionId = activeCodexSession?.sessionId;
    if (!sessionId) return;
    setConfirmAction({ kind: "delete", sessionId });
  }

  function handleRenameActiveSession() {
    requestRenameSession(activeCodexSession);
  }

  function requestArchiveSession(sessionId: string) {
    if (!sessionId) return;
    setConfirmAction({ kind: "archive", sessionId });
  }

  function requestDeleteSession(sessionId: string) {
    if (!sessionId) return;
    setConfirmAction({ kind: "delete", sessionId });
  }

  async function handleConfirmAction() {
    if (!confirmAction) return;
    const { kind, sessionId } = confirmAction;
    setConfirmAction(null);
    if (kind === "archive") {
      await archiveCodexSessionById(sessionId);
    } else {
      await deleteCodexSessionById(sessionId);
    }
  }

  function handleOpenInspector() {
    setInspectorVariant(activeCodexSession ? "session" : "workspace");
    setInspectorOpen(true);
  }

  function handleOpenWorkspaceInfo() {
    setInspectorVariant("workspace");
    setInspectorOpen(true);
  }

  return (
    <ToastProvider>
      <div className="flex h-[100dvh] min-h-0 flex-col bg-gradient-to-b from-background to-muted/40 px-4 md:px-6 lg:px-8">
      <header className="sticky top-0 z-20 -mx-4 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileRailOpen(true)}
            aria-label="Open threads list"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground md:hidden"
          >
            <MenuIcon />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm font-semibold text-foreground md:text-base">Codex</span>
            <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {workspaceLabel}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {formatInt(totalVisibleForHeader)} {totalVisibleForHeader === 1 ? "thread" : "threads"}
          </span>
          <button
            type="button"
            onClick={handleOpenWorkspaceInfo}
            disabled={!canOpenInfo}
            aria-label="Workspace info"
            title="Workspace info"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50"
          >
            <InfoIcon />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "hidden h-full shrink-0 border-r border-border/60 motion-safe:transition-[width] motion-safe:duration-200 md:block",
            railCollapsed ? "w-14" : "w-72 lg:w-80",
          )}
        >
          <SessionList
            workspaceOptions={START_WORKSPACE_OPTIONS}
            newCodexWorkspaceKey={newCodexWorkspaceKey}
            setNewCodexWorkspaceKey={setNewCodexWorkspaceKey}
            newCodexPrompt={newCodexPrompt}
            setNewCodexPrompt={setNewCodexPrompt}
            selectedCreateWorkspace={selectedCreateWorkspace}
            codexMutationPending={codexMutationPending}
            onCreateCodexSession={() => void handleCreateCodexSession()}
            codexVisibleTotal={codexVisibleTotal}
            visibleCodexSessions={visibleCodexSessions}
            codexMatchedTotal={codexMatchedTotal}
            codexSessionGroups={codexSessionGroups}
            codexLatestUpdatedAt={codexLatestUpdatedAt}
            codexSummary={codexSummary}
            codexError={codexError}
            provisionalCodexSession={provisionalCodexSession}
            activeCodexThreadId={activeCodexThreadId}
            setSelectedCodexSessionId={handleSelectCodexSession}
            onRenameSession={requestRenameSession}
            onArchiveSession={requestArchiveSession}
            onDeleteSession={requestDeleteSession}
            formatInt={formatInt}
            formatCompactPath={formatCompactPath}
            formatRelativeTimestamp={formatRelativeTimestamp}
            formatTimestamp={formatTimestamp}
            getCodexSessionTitle={getCodexSessionTitle}
            newThreadOpen={newThreadOpen}
            onOpenNewThread={() => setNewThreadOpen(true)}
            onCloseNewThread={() => setNewThreadOpen(false)}
            collapsed={railCollapsed}
            onToggleCollapsed={toggleRailCollapsed}
            focusSearchSignal={focusSearchSignal}
            lastOpenedAt={lastOpenedAt}
          />
        </div>

        <ChatPane
          transcriptViewportRef={transcriptViewportRef}
          activeCodexSession={activeCodexSession}
          activeSessionHasRunInProgress={activeSessionHasRunInProgress}
          activeCodexTitle={activeCodexTitle}
          activeCodexMessageCount={activeCodexMessageCount}
          codexMutationPending={codexMutationPending}
          copiedSessionId={copiedSessionId}
          onCopySessionId={() => void handleCopySessionId()}
          onArchiveCodexSession={handleArchiveActiveSession}
          onDeleteCodexSession={handleDeleteActiveSession}
          selectedCodexSession={selectedCodexSession}
          selectedCodexSessionId={selectedCodexSessionId}
          selectedCodexPagination={selectedCodexPagination}
          codexDetailLoading={codexDetailLoading}
          codexOlderLoading={codexOlderLoading}
          hasCodexTranscriptContent={hasCodexTranscriptContent}
          pendingCodexUserEvent={visiblePendingCodexUserEvent}
          streamedAssistantEvents={visibleStreamedAssistantEvents}
          codexMutationError={codexMutationError}
          replyComposerError={replyComposerError}
          replyPrompt={replyPrompt}
          setReplyPrompt={handleReplyPromptChange}
          onReplyToCodexSession={() => void handleReplyToCodexSession()}
          formatTimestamp={formatTimestamp}
          formatRelativeTimestamp={formatRelativeTimestamp}
          formatShortSessionId={formatShortSessionId}
          onOpenInspector={handleOpenInspector}
          onStartNewThread={() => setNewThreadOpen(true)}
          onPickSuggestion={(text) => {
            setNewCodexPrompt(text);
            setNewThreadOpen(true);
          }}
        />
      </div>

      {loading ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center py-2 text-xs text-muted-foreground">
          Loading Codex sessions…
        </div>
      ) : null}

      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden motion-safe:transition-opacity motion-safe:duration-200",
          mobileRailOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileRailOpen}
      >
        <button
          type="button"
          aria-label="Close threads list"
          tabIndex={mobileRailOpen ? 0 : -1}
          onClick={() => setMobileRailOpen(false)}
          className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Threads"
          className={cn(
            "absolute inset-y-0 left-0 flex h-full w-[82%] max-w-sm flex-col border-r border-border/60 bg-background shadow-xl motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
            mobileRailOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SessionList
            workspaceOptions={START_WORKSPACE_OPTIONS}
            newCodexWorkspaceKey={newCodexWorkspaceKey}
            setNewCodexWorkspaceKey={setNewCodexWorkspaceKey}
            newCodexPrompt={newCodexPrompt}
            setNewCodexPrompt={setNewCodexPrompt}
            selectedCreateWorkspace={selectedCreateWorkspace}
            codexMutationPending={codexMutationPending}
            onCreateCodexSession={() => void handleCreateCodexSession()}
            codexVisibleTotal={codexVisibleTotal}
            visibleCodexSessions={visibleCodexSessions}
            codexMatchedTotal={codexMatchedTotal}
            codexSessionGroups={codexSessionGroups}
            codexLatestUpdatedAt={codexLatestUpdatedAt}
            codexSummary={codexSummary}
            codexError={codexError}
            provisionalCodexSession={provisionalCodexSession}
            activeCodexThreadId={activeCodexThreadId}
            setSelectedCodexSessionId={handleSelectCodexSession}
            onRenameSession={requestRenameSession}
            onArchiveSession={requestArchiveSession}
            onDeleteSession={requestDeleteSession}
            formatInt={formatInt}
            formatCompactPath={formatCompactPath}
            formatRelativeTimestamp={formatRelativeTimestamp}
            formatTimestamp={formatTimestamp}
            getCodexSessionTitle={getCodexSessionTitle}
            newThreadOpen={newThreadOpen}
            onOpenNewThread={() => setNewThreadOpen(true)}
            onCloseNewThread={() => setNewThreadOpen(false)}
            focusSearchSignal={focusSearchSignal}
            lastOpenedAt={lastOpenedAt}
          />
        </div>
      </div>

      <Inspector
        variant={inspectorVariant}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        activeCodexSession={activeCodexSession}
        codexMutationPending={codexMutationPending}
        onRenameCodexSession={handleRenameActiveSession}
        onArchiveCodexSession={handleArchiveActiveSession}
        onDeleteCodexSession={handleDeleteActiveSession}
        onCopySessionId={() => void handleCopySessionId()}
        copiedSessionId={copiedSessionId}
        codexSummary={codexSummary}
        codexVisibleTotal={codexVisibleTotal}
        visibleCodexSessions={visibleCodexSessions}
        codexSessionGroups={codexSessionGroups}
        codexLatestUpdatedAt={codexLatestUpdatedAt}
        formatInt={formatInt}
        formatTimestamp={formatTimestamp}
        formatRelativeTimestamp={formatRelativeTimestamp}
        getCodexSessionTitle={getCodexSessionTitle}
      />
      {renameAction ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-thread-heading"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Cancel rename"
            onClick={() => setRenameAction(null)}
            className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
          />
          <form
            ref={renameDialogRef}
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameDisabled) {
                void renameCodexSessionById(renameAction.sessionId, renameThreadName);
              }
            }}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-xl"
          >
            <h2
              id="rename-thread-heading"
              className="text-base font-semibold tracking-tight text-foreground"
            >
              Rename thread
            </h2>
            <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="rename-thread-name">
              Thread name
            </label>
            <input
              ref={renameInputRef}
              id="rename-thread-name"
              type="text"
              value={renameThreadName}
              onChange={(event) => setRenameThreadName(event.target.value)}
              maxLength={120}
              className="mt-2 h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:border-border/40"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameAction(null)}
                className="inline-flex h-9 items-center rounded-xl border border-border/60 bg-background px-4 text-sm font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-border/40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renameDisabled}
                className="inline-flex h-9 items-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {codexMutationPending === "rename" ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.kind === "delete" ? "Delete thread?" : "Archive thread?"}
        description={
          confirmAction?.kind === "delete"
            ? "This will permanently delete the Codex thread transcript. You can't undo this from Mission Control."
            : "The thread will disappear from Mission Control and active resume views. You can still reopen the session locally."
        }
        confirmLabel={confirmAction?.kind === "delete" ? "Delete" : "Archive"}
        tone={confirmAction?.kind === "delete" ? "danger" : "default"}
        pending={
          (confirmAction?.kind === "archive" && codexMutationPending === "archive") ||
          (confirmAction?.kind === "delete" && codexMutationPending === "delete")
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <Toaster />

      {shortcutsHelpOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-help-heading"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={() => setShortcutsHelpOpen(false)}
            className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
          />
          <div
            ref={helpDialogRef}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-xl"
          >
            <h2
              id="shortcuts-help-heading"
              className="text-base font-semibold tracking-tight text-foreground"
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Available anywhere in Mission Control.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <ShortcutRow label="Focus search" combo="⌘/Ctrl + K" />
              <ShortcutRow label="Toggle threads rail" combo="⌘/Ctrl + \\" />
              <ShortcutRow label="New Codex thread" combo="⌘/Ctrl + N" />
              <ShortcutRow label="Show this help" combo="?" />
              <ShortcutRow label="Close any overlay" combo="Esc" />
            </dl>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShortcutsHelpOpen(false)}
                className="inline-flex h-9 items-center rounded-xl border border-border/60 bg-background px-4 text-sm font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-border/40"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </ToastProvider>
  );
}

function ShortcutRow({ label, combo }: { label: string; combo: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-foreground">{label}</dt>
      <dd>
        <kbd className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground dark:border-border/40">
          {combo}
        </kbd>
      </dd>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
