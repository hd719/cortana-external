"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Star,
  StarOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";

import type {
  CodexMutationKind,
  CodexSession,
  CodexSessionGroup,
  WorkspaceOption,
} from "./types";

type CodexSummary = {
  total: number;
  latestUpdatedAt: number | null;
  withCwd: number;
  withPreview: number;
};

type SessionListProps = {
  workspaceOptions: readonly WorkspaceOption[];
  newCodexWorkspaceKey: string;
  setNewCodexWorkspaceKey: (key: string) => void;
  newCodexPrompt: string;
  setNewCodexPrompt: (value: string) => void;
  selectedCreateWorkspace: WorkspaceOption;
  codexMutationPending: CodexMutationKind | null;
  onCreateCodexSession: () => void;
  codexVisibleTotal: number;
  visibleCodexSessions: CodexSession[];
  codexMatchedTotal: number;
  codexSessionGroups: CodexSessionGroup[];
  codexLatestUpdatedAt: number | null;
  codexSummary: CodexSummary;
  codexError: string | null;
  provisionalCodexSession: CodexSession | null;
  activeCodexThreadId: string | null;
  setSelectedCodexSessionId: (sessionId: string | null) => void;
  onRenameSession?: (session: CodexSession) => void;
  onArchiveSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  formatInt: (value: number) => string;
  formatCompactPath: (value: string | null | undefined, keepSegments?: number) => string;
  formatRelativeTimestamp: (value: number | null | undefined) => string;
  formatTimestamp?: (value: number | null | undefined) => string;
  getCodexSessionTitle: (session: Pick<CodexSession, "threadName" | "sessionId"> | null | undefined) => string;
  className?: string;
  newThreadOpen: boolean;
  onOpenNewThread: () => void;
  onCloseNewThread: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  focusSearchSignal?: number;
  lastOpenedAt?: Record<string, number>;
};

const START_COMPOSER_MAX_HEIGHT_PX = 192;
const START_COMPOSER_MIN_HEIGHT_PX = 40;
const PINNED_STORAGE_KEY = "mc-pinned-sessions";

const MONOGRAM_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-amber-500",
] as const;

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickMonogramColor(seed: string) {
  if (!seed) return MONOGRAM_COLORS[0];
  return MONOGRAM_COLORS[hashString(seed) % MONOGRAM_COLORS.length];
}

function deriveMonogram(title: string, fallbackSeed: string) {
  const trimmed = title.trim();
  if (!trimmed) {
    const seed = fallbackSeed.trim();
    return seed.slice(0, 2).toUpperCase() || "CX";
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  }
  const first = words[0] ?? trimmed;
  return first.slice(0, 2).toUpperCase();
}

function useStartComposerAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      const next = Math.min(
        Math.max(el.scrollHeight, START_COMPOSER_MIN_HEIGHT_PX),
        START_COMPOSER_MAX_HEIGHT_PX,
      );
      el.style.height = `${next}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [value]);

  return ref;
}

function loadPinnedFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is string => typeof value === "string"));
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function persistPinned(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore */
  }
}

export function SessionList({
  workspaceOptions,
  newCodexWorkspaceKey,
  setNewCodexWorkspaceKey,
  newCodexPrompt,
  setNewCodexPrompt,
  selectedCreateWorkspace,
  codexMutationPending,
  onCreateCodexSession,
  codexVisibleTotal,
  visibleCodexSessions,
  codexMatchedTotal,
  codexSessionGroups,
  codexLatestUpdatedAt,
  codexSummary,
  codexError,
  provisionalCodexSession,
  activeCodexThreadId,
  setSelectedCodexSessionId,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  formatInt,
  formatCompactPath,
  formatRelativeTimestamp,
  formatTimestamp,
  getCodexSessionTitle,
  className,
  newThreadOpen,
  onOpenNewThread,
  onCloseNewThread,
  collapsed = false,
  onToggleCollapsed,
  focusSearchSignal,
  lastOpenedAt,
}: SessionListProps) {
  const startTextareaRef = useStartComposerAutosize(newCodexPrompt);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const newThreadDialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const createPending = codexMutationPending === "create";
  const startDisabled = createPending || !newCodexPrompt.trim();
  const totalVisible = codexVisibleTotal || visibleCodexSessions.length;
  const hiddenDueToFilter = codexMatchedTotal > totalVisible;

  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedFromStorage());
  const { showToast } = useToast();

  useFocusTrap(newThreadDialogRef, newThreadOpen);

  useEffect(() => {
    if (!newThreadOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseNewThread();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [newThreadOpen, onCloseNewThread]);

  useEffect(() => {
    if (newThreadOpen) {
      const timer = window.setTimeout(() => {
        startTextareaRef.current?.focus();
      }, 10);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [newThreadOpen, startTextareaRef]);

  useEffect(() => {
    if (focusSearchSignal == null) return;
    if (collapsed) return;
    const el = searchInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [focusSearchSignal, collapsed]);

  const togglePinned = (sessionId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
        showToast("Thread unpinned");
      } else {
        next.add(sessionId);
        showToast("Thread pinned");
      }
      persistPinned(next);
      return next;
    });
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchesQuery = (session: CodexSession) => {
    if (!normalizedQuery) return true;
    const title = getCodexSessionTitle(session).toLowerCase();
    const cwd = (session.cwd ?? "").toLowerCase();
    return title.includes(normalizedQuery) || cwd.includes(normalizedQuery);
  };

  const isUnread = (session: CodexSession) => {
    if (!session.sessionId) return false;
    if (!lastOpenedAt) return false;
    if (!session.updatedAt) return false;
    const opened = lastOpenedAt[session.sessionId];
    if (opened == null) return true;
    return session.updatedAt > opened;
  };

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return codexSessionGroups;
    return codexSessionGroups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter(matchesQuery),
      }))
      .filter((group) => group.sessions.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codexSessionGroups, normalizedQuery]);

  const pinnedSessions = useMemo(() => {
    if (pinnedIds.size === 0) return [] as CodexSession[];
    const byId = new Map<string, CodexSession>();
    for (const group of codexSessionGroups) {
      for (const session of group.sessions) {
        if (session.sessionId && pinnedIds.has(session.sessionId)) {
          byId.set(session.sessionId, session);
        }
      }
    }
    const result = Array.from(byId.values());
    if (normalizedQuery) {
      return result.filter(matchesQuery);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codexSessionGroups, pinnedIds, normalizedQuery]);

  const allCollapsedSessions = useMemo(() => {
    const ids = new Set<string>();
    const sessions: CodexSession[] = [];
    for (const s of pinnedSessions) {
      if (s.sessionId && !ids.has(s.sessionId)) {
        ids.add(s.sessionId);
        sessions.push(s);
      }
    }
    for (const group of codexSessionGroups) {
      for (const s of group.sessions) {
        if (s.sessionId && !ids.has(s.sessionId)) {
          ids.add(s.sessionId);
          sessions.push(s);
        }
      }
    }
    return sessions;
  }, [codexSessionGroups, pinnedSessions]);

  const handleStartKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const metaSend = event.key === "Enter" && (event.metaKey || event.ctrlKey);
    const plainSend = event.key === "Enter" && !event.shiftKey;
    if (metaSend || plainSend) {
      event.preventDefault();
      if (!startDisabled) {
        onCreateCodexSession();
      }
    }
  };

  const handleActionClick = (
    event: MouseEvent<HTMLButtonElement>,
    session: CodexSession,
    action: "archive" | "delete" | "pin" | "rename",
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (action === "archive") {
      onArchiveSession?.(session.sessionId);
    } else if (action === "delete") {
      onDeleteSession?.(session.sessionId);
    } else if (action === "pin") {
      togglePinned(session.sessionId);
    } else if (action === "rename") {
      onRenameSession?.(session);
    }
  };

  const renderSessionRow = (
    session: CodexSession,
    options: { groupLabel: string; groupRoot?: string | null },
  ) => {
    const selected = session.sessionId === activeCodexThreadId;
    const title = getCodexSessionTitle(session);
    const monogramSeed = session.cwd ?? options.groupRoot ?? session.sessionId;
    const monogramColor = pickMonogramColor(monogramSeed);
    const monogram = deriveMonogram(title, options.groupLabel);
    const preview =
      session.lastMessagePreview?.trim() ||
      (session.cwd ? session.cwd.split("/").filter(Boolean).slice(-1)[0] ?? "" : "") ||
      "No transcript preview yet";
    const hasActions = Boolean(onRenameSession || onArchiveSession || onDeleteSession);
    const pinned = session.sessionId ? pinnedIds.has(session.sessionId) : false;
    const unread = !selected && isUnread(session);
    const absoluteTimestamp = formatTimestamp ? formatTimestamp(session.updatedAt) : undefined;

    return (
      <div
        key={session.sessionId}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 motion-safe:transition-colors",
          selected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-muted/60 active:bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => setSelectedCodexSessionId(session.sessionId)}
          aria-pressed={selected}
          aria-label={`Open thread ${title}`}
          className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        />
        <span
          className={cn(
            "pointer-events-none relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
            monogramColor,
          )}
        >
          {monogram}
        </span>
        <span className="pointer-events-none relative z-10 min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">
              {title}
            </span>
            {session.isSubagent ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Subagent
              </span>
            ) : null}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {preview}
          </span>
        </span>
        <span className="relative z-10 flex shrink-0 items-center gap-1.5">
          <span
            title={absoluteTimestamp}
            className={cn(
              "text-[11px] text-muted-foreground motion-safe:transition-opacity",
              hasActions ? "group-hover:opacity-0" : "",
            )}
          >
            {formatRelativeTimestamp(session.updatedAt)}
          </span>
          {unread ? (
            <span
              aria-label="Unread"
              className="size-2 rounded-full bg-blue-500 dark:bg-blue-400"
            />
          ) : null}
          {selected ? (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-blue-500 dark:bg-blue-400"
            />
          ) : null}
          {hasActions ? (
            <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 motion-safe:transition-opacity group-hover:opacity-100">
              {session.sessionId ? (
                <button
                  type="button"
                  onClick={(event) => handleActionClick(event, session, "pin")}
                  aria-label={pinned ? "Unpin thread" : "Pin thread"}
                  title={pinned ? "Unpin thread" : "Pin thread"}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted/40",
                    pinned ? "text-blue-600 dark:text-blue-400" : "",
                  )}
                >
                  {pinned ? (
                    <StarOff className="h-3.5 w-3.5" />
                  ) : (
                    <Star className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
              {onRenameSession ? (
                <button
                  type="button"
                  onClick={(event) => handleActionClick(event, session, "rename")}
                  aria-label="Rename thread"
                  title="Rename thread"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted/40"
                  disabled={codexMutationPending != null}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onArchiveSession ? (
                <button
                  type="button"
                  onClick={(event) => handleActionClick(event, session, "archive")}
                  aria-label="Archive thread"
                  title="Archive thread"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted/40"
                  disabled={codexMutationPending != null}
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onDeleteSession ? (
                <button
                  type="button"
                  onClick={(event) => handleActionClick(event, session, "delete")}
                  aria-label="Delete thread"
                  title="Delete thread"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted/40"
                  disabled={codexMutationPending != null}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  if (collapsed) {
    return (
      <aside
        className={cn(
          "flex h-full min-h-0 w-14 min-w-0 flex-col overflow-hidden bg-background",
          className,
        )}
        aria-label="Codex threads (collapsed)"
      >
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-border/60">
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expand threads rail"
              title="Expand threads rail"
              className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto py-3">
          <button
            type="button"
            onClick={onOpenNewThread}
            aria-label="Start a new Codex thread"
            className="inline-flex size-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-600/50 dark:bg-blue-500 dark:hover:bg-blue-600"
            disabled={createPending}
          >
            {createPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
          {allCollapsedSessions.map((session) => {
            const selected = session.sessionId === activeCodexThreadId;
            const title = getCodexSessionTitle(session);
            const monogramSeed = session.cwd ?? session.sessionId;
            const monogramColor = pickMonogramColor(monogramSeed);
            const monogram = deriveMonogram(title, title);
            const unread = !selected && isUnread(session);
            return (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => setSelectedCodexSessionId(session.sessionId)}
                aria-label={`Open thread ${title}`}
                aria-pressed={selected}
                title={title}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
                  monogramColor,
                  selected ? "ring-2 ring-blue-500/80 ring-offset-1 ring-offset-background" : "",
                )}
              >
                {monogram}
                {unread ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background bg-blue-500 dark:bg-blue-400"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
      aria-label="Codex threads"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Threads
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {formatInt(totalVisible)}
          </span>
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse threads rail"
              title="Collapse threads rail"
              className="hidden size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 md:inline-flex"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
          <Button
            type="button"
            onClick={onOpenNewThread}
            aria-label="Start a new Codex thread"
            className="size-9 rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-600/50 dark:bg-blue-500 dark:hover:bg-blue-600"
            disabled={createPending}
          >
            {createPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:border-border/40 dark:focus-visible:border-blue-400"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {hiddenDueToFilter ? (
          <p className="px-3 pb-2 text-[11px] text-muted-foreground">
            Matched {formatInt(codexMatchedTotal)} · showing {formatInt(totalVisible)}
          </p>
        ) : null}

        {provisionalCodexSession ? (
          <button
            type="button"
            onClick={() =>
              provisionalCodexSession.sessionId && setSelectedCodexSessionId(provisionalCodexSession.sessionId)
            }
            className="group mb-1 flex w-full animate-pulse items-center gap-3 rounded-xl bg-accent/60 px-3 py-2.5 text-left"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-[13px] font-medium text-foreground">
                Starting thread…
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {provisionalCodexSession.lastMessagePreview ?? getCodexSessionTitle(provisionalCodexSession)}
              </span>
            </span>
          </button>
        ) : null}

        {!codexError && visibleCodexSessions.length === 0 && !provisionalCodexSession ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No Codex sessions yet. Tap + to start one.
          </div>
        ) : null}

        {!codexError && normalizedQuery && filteredGroups.length === 0 && pinnedSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No threads match “{searchQuery}”.
          </div>
        ) : null}

        {pinnedSessions.length > 0 ? (
          <div className="mb-3">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Pinned
              </p>
            </div>
            <div className="space-y-0.5">
              {pinnedSessions.map((session) =>
                renderSessionRow(session, { groupLabel: "Pinned", groupRoot: session.cwd }),
              )}
            </div>
          </div>
        ) : null}

        {filteredGroups.map((group) => (
          <div key={group.id} className="mb-3">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {group.label}
              </p>
              {group.isActive ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
                  active
                </span>
              ) : null}
            </div>
            <div className="space-y-0.5">
              {group.sessions.map((session) =>
                renderSessionRow(session, { groupLabel: group.label, groupRoot: group.rootPath }),
              )}
            </div>
          </div>
        ))}

        {codexError ? (
          <div className="mx-3 mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {codexError}
          </div>
        ) : null}

        {codexSummary.latestUpdatedAt || codexLatestUpdatedAt ? (
          <p className="px-3 pt-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
            Synced {formatRelativeTimestamp(codexLatestUpdatedAt ?? codexSummary.latestUpdatedAt)}
          </p>
        ) : null}
      </div>

      {newThreadOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-thread-heading"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close new thread dialog"
            onClick={onCloseNewThread}
            className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
          />
          <div
            ref={newThreadDialogRef}
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div>
                <h2 id="new-thread-heading" className="text-base font-semibold tracking-tight text-foreground">
                  Start a new Codex thread
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pick a workspace and describe the task.
                </p>
              </div>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCloseNewThread}
                aria-label="Close dialog"
                className="rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {workspaceOptions.map((workspace) => {
                  const selected = workspace.key === newCodexWorkspaceKey;
                  return (
                    <button
                      key={workspace.key}
                      type="button"
                      onClick={() => setNewCodexWorkspaceKey(workspace.key)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
                        selected
                          ? "border-blue-500 bg-blue-600 text-white dark:bg-blue-500"
                          : "border-border/60 bg-background text-foreground hover:border-blue-500/40 hover:bg-muted/60",
                      )}
                    >
                      <p className="text-sm font-semibold">{workspace.label}</p>
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          selected ? "text-white/80" : "text-muted-foreground",
                        )}
                      >
                        {formatCompactPath(workspace.cwd, 4)}
                      </p>
                    </button>
                  );
                })}
              </div>

              <Textarea
                ref={startTextareaRef}
                rows={1}
                value={newCodexPrompt}
                onChange={(event) => setNewCodexPrompt(event.target.value)}
                onKeyDown={handleStartKeyDown}
                placeholder="Outline the task, repo, or question"
                disabled={createPending}
                aria-label="New Codex thread prompt"
                className="w-full resize-none rounded-xl border border-border/60 bg-background px-3 py-2 text-sm leading-6 shadow-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
              />

              <p className="text-xs text-muted-foreground">
                Creates the thread in {formatCompactPath(selectedCreateWorkspace.cwd, 4)}.
              </p>

              <div className="flex items-center justify-between gap-3">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  Enter to send · Shift+Enter for newline
                </span>
                <Button
                  type="button"
                  onClick={() => onCreateCodexSession()}
                  disabled={startDisabled}
                  aria-label="Start Codex thread"
                  className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:bg-blue-600/50 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  {createPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    "Start Codex thread"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
