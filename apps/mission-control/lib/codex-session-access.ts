import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getCodexMirroredSessionDetail,
  listCodexMirroredSessions,
  reconcileCodexMirrorSession,
  syncCodexMirrorThreadFromSession,
} from "@/lib/codex-mirror";
import type { CodexSessionDetail, CodexSessionEvent, CodexSessionSummary } from "@/lib/codex-sessions";
import {
  getCodexSessionDetail,
  listCodexSessionIndexSummariesById,
  listCodexSessions,
  type CodexSessionEvent as FileCodexSessionEvent,
} from "@/lib/codex-sessions";

const DEFAULT_CODEX_ROOT = path.join(os.homedir(), ".codex");
const DEFAULT_CODEX_GLOBAL_STATE_PATH = path.join(DEFAULT_CODEX_ROOT, ".codex-global-state.json");
const DEFAULT_VISIBLE_GROUP_SESSION_LIMIT = 5;
const DEFAULT_DISCOVERY_LIMIT = 100;
const UNKNOWN_WORKSPACE_GROUP_ID = "__unknown_codex_workspace__";

type CodexDesktopSidebarState = {
  activeWorkspaceRoots: string[];
  savedWorkspaceRoots: string[];
  collapsedGroups: string[];
};

type CodexLocalThreadStateRow = {
  id: string;
  title: string | null;
  cwd: string | null;
  source: string | null;
  first_user_message: string | null;
  archived: number;
  has_user_event: number | null;
  updated_at_ms: number | null;
};

export type CodexSessionGroup = {
  id: string;
  label: string;
  rootPath: string;
  isActive: boolean;
  isCollapsed: boolean;
  hiddenSessionCount: number;
  sessions: CodexSessionSummary[];
};

export type VisibleCodexSessionsResult = {
  sessions: CodexSessionSummary[];
  groups: CodexSessionGroup[];
  latestUpdatedAt: number | null;
  totalMatchedSessions: number;
  totalVisibleSessions: number;
};

type SidebarGroupingInput = {
  session: CodexSessionSummary;
  stateRow: CodexLocalThreadStateRow | null;
  rootPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizePath(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function comparablePath(value: string | null | undefined) {
  const normalized = normalizePath(value);
  if (!normalized) return null;
  const usesMacUserRoot = normalized === "/Users" || normalized.startsWith("/Users/");
  return process.platform === "darwin" || usesMacUserRoot ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(targetPath: string | null | undefined, rootPath: string | null | undefined) {
  const normalizedTarget = comparablePath(targetPath);
  const normalizedRoot = comparablePath(rootPath);
  if (!normalizedTarget || !normalizedRoot) return false;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function getRootMatchScore(rootPath: string, activeRoots: Set<string>, savedRoots: Set<string>) {
  if (activeRoots.has(rootPath)) return 0;
  if (savedRoots.has(rootPath)) return 1;
  return 2;
}

function getWorkspaceLabel(rootPath: string) {
  if (rootPath === UNKNOWN_WORKSPACE_GROUP_ID) {
    return "Other";
  }

  const label = path.basename(rootPath);
  return label.trim().length > 0 ? label : rootPath;
}

function deriveFallbackWorkspaceRoot(cwd: string | null | undefined, homeDir = os.homedir()) {
  const normalizedCwd = normalizePath(cwd);
  const normalizedHome = normalizePath(homeDir);
  if (!normalizedCwd || !normalizedHome || !isWithinRoot(normalizedCwd, normalizedHome)) {
    return null;
  }

  const relativePath = path.relative(normalizedHome, normalizedCwd);
  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  if (segments[0]?.toLowerCase() === "developer" && segments[1]) {
    return path.join(normalizedHome, "Developer", segments[1]);
  }

  if (segments[0].startsWith(".")) {
    return null;
  }

  return path.join(normalizedHome, segments[0]);
}

function deriveWorkspaceRoot(
  cwd: string | null | undefined,
  preferredRoots: string[],
  homeDir = os.homedir(),
) {
  const normalizedCwd = normalizePath(cwd);
  if (!normalizedCwd) return null;

  const sortedRoots = [...preferredRoots].sort((left, right) => right.length - left.length);
  const matchingRoot = sortedRoots.find((candidate) => isWithinRoot(normalizedCwd, candidate));
  if (matchingRoot) {
    return matchingRoot;
  }

  return deriveFallbackWorkspaceRoot(normalizedCwd, homeDir);
}

function isSubagentThread(source: string | null | undefined) {
  if (!source) return false;
  return source.includes("thread_spawn") || source.includes("\"subagent\"");
}

function isUtilityCliThread(row: CodexLocalThreadStateRow | null, session: CodexSessionSummary) {
  const source = row?.source ?? session.source;
  const cwd = row?.cwd ?? session.cwd;
  const title = (row?.title ?? session.threadName ?? "").trim();

  if (source !== "cli") return false;
  if (!cwd || !cwd.includes(`${path.sep}scripts`)) return false;
  return /^[a-z0-9:_-]{1,48}$/i.test(title);
}

function isSyntheticNamedThread(row: CodexLocalThreadStateRow | null, session: CodexSessionSummary) {
  if (!row) return false;
  const source = row?.source ?? session.source;
  const firstUserMessage = row?.first_user_message?.trim() ?? "";
  if (source !== "vscode") return false;
  if (firstUserMessage.length > 0) return false;
  return !session.lastMessagePreview?.trim();
}

function isMissionControlTestThread(row: CodexLocalThreadStateRow | null, session: CodexSessionSummary) {
  const source = row?.source ?? session.source;
  if (source !== "exec") return false;

  const title = (row?.title ?? session.threadName ?? row?.first_user_message ?? "").trim().toLowerCase();
  if (!title) return false;

  return (
    title === "testing from mission control"
    || title === "hey this a test"
    || title.startsWith("reply with exactly:")
  );
}

function isArchivedTranscriptSession(session: CodexSessionSummary) {
  const transcriptPath = normalizePath(session.transcriptPath);
  if (!transcriptPath) return false;

  const archivedRoot = path.join(DEFAULT_CODEX_ROOT, "archived_sessions");
  if (isWithinRoot(transcriptPath, archivedRoot)) {
    return true;
  }

  const pathSegments = transcriptPath.split(path.sep).filter(Boolean);
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    if (pathSegments[index] === ".codex" && pathSegments[index + 1] === "archived_sessions") {
      return true;
    }
  }

  return false;
}

function getSessionSourceRank(row: CodexLocalThreadStateRow | null, session: CodexSessionSummary) {
  const source = (row?.source ?? session.source ?? "").trim();
  if (source === "vscode") return 0;
  if (source === "exec") return 2;
  if (source === "cli") return 3;
  return 1;
}

function shouldExposeSessionInSidebar(
  session: CodexSessionSummary,
  stateRow: CodexLocalThreadStateRow | null,
) {
  const source = (stateRow?.source ?? session.source ?? "").trim();
  const isSubagent = session.isSubagent || isSubagentThread(stateRow?.source ?? session.source);
  if (stateRow?.archived) return false;
  if (isArchivedTranscriptSession(session)) return false;
  if (source.length > 0 && source !== "vscode" && source !== "exec" && !isSubagent) return false;
  if (isUtilityCliThread(stateRow, session)) return false;
  if (isSyntheticNamedThread(stateRow, session)) return false;
  if (isMissionControlTestThread(stateRow, session)) return false;
  return true;
}

async function readCodexDesktopSidebarState(
  globalStatePath = DEFAULT_CODEX_GLOBAL_STATE_PATH,
): Promise<CodexDesktopSidebarState> {
  try {
    const raw = await fs.readFile(globalStatePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        activeWorkspaceRoots: [],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      };
    }

    const atomState = isRecord(parsed["electron-persisted-atom-state"])
      ? parsed["electron-persisted-atom-state"]
      : null;

    const activeWorkspaceRoots = Array.isArray(parsed["active-workspace-roots"])
      ? parsed["active-workspace-roots"]
          .map((value) => (typeof value === "string" ? normalizePath(value) : null))
          .filter((value): value is string => Boolean(value))
      : [];

    const savedWorkspaceRoots = Array.isArray(parsed["electron-saved-workspace-roots"])
      ? parsed["electron-saved-workspace-roots"]
          .map((value) => (typeof value === "string" ? normalizePath(value) : null))
          .filter((value): value is string => Boolean(value))
      : [];

    const collapsedGroups = atomState && isRecord(atomState["sidebar-collapsed-groups"])
      ? Object.entries(atomState["sidebar-collapsed-groups"])
          .filter((entry): entry is [string, boolean] => typeof entry[0] === "string" && entry[1] === true)
          .map(([groupPath]) => normalizePath(groupPath))
          .filter((value): value is string => Boolean(value))
      : [];

    return {
      activeWorkspaceRoots,
      savedWorkspaceRoots,
      collapsedGroups,
    };
  } catch {
    return {
      activeWorkspaceRoots: [],
      savedWorkspaceRoots: [],
      collapsedGroups: [],
    };
  }
}

export function buildVisibleCodexSessionGroups(
  sessions: CodexSessionSummary[],
  threadRows: CodexLocalThreadStateRow[],
  sidebarState: CodexDesktopSidebarState,
  options: {
    limit?: number;
    perGroupLimit?: number;
    homeDir?: string;
  } = {},
): VisibleCodexSessionsResult {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), DEFAULT_DISCOVERY_LIMIT));
  const perGroupLimit = Math.max(1, Math.min(Math.floor(options.perGroupLimit ?? DEFAULT_VISIBLE_GROUP_SESSION_LIMIT), 10));
  const homeDir = options.homeDir ?? os.homedir();
  const preferredRoots = [
    ...new Set(
      [...sidebarState.activeWorkspaceRoots, ...sidebarState.savedWorkspaceRoots]
        .map((value) => normalizePath(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const stateRowsById = new Map(threadRows.map((row) => [row.id, row]));
  const activeRoots = new Set(
    sidebarState.activeWorkspaceRoots
      .map((value) => normalizePath(value))
      .filter((value): value is string => Boolean(value)),
  );
  const savedRoots = new Set(
    sidebarState.savedWorkspaceRoots
      .map((value) => normalizePath(value))
      .filter((value): value is string => Boolean(value)),
  );
  const collapsedGroups = new Set(
    sidebarState.collapsedGroups
      .map((value) => normalizePath(value))
      .filter((value): value is string => Boolean(value)),
  );

  const grouped = new Map<string, SidebarGroupingInput[]>();

  for (const session of sessions) {
    const stateRow = stateRowsById.get(session.sessionId) ?? null;
    if (!shouldExposeSessionInSidebar(session, stateRow)) {
      continue;
    }

    const rootPath =
      deriveWorkspaceRoot(stateRow?.cwd ?? session.cwd, preferredRoots, homeDir)
      ?? UNKNOWN_WORKSPACE_GROUP_ID;

    const current = grouped.get(rootPath) ?? [];
    current.push({ session, stateRow, rootPath });
    grouped.set(rootPath, current);
  }

  const orderedGroups = [...grouped.entries()]
    .map(([rootPath, entries]) => {
      const sortedEntries = [...entries].sort(
        (left, right) => {
          const updatedAtDelta = (right.session.updatedAt ?? 0) - (left.session.updatedAt ?? 0);
          if (updatedAtDelta !== 0) return updatedAtDelta;

          const sourceDelta = getSessionSourceRank(left.stateRow, left.session)
            - getSessionSourceRank(right.stateRow, right.session);
          if (sourceDelta !== 0) return sourceDelta;
          return 0;
        },
      );
      return {
        rootPath,
        totalCount: sortedEntries.length,
        entries: sortedEntries,
      };
    })
    .sort((left, right) => {
      const leftIsUnknown = left.rootPath === UNKNOWN_WORKSPACE_GROUP_ID;
      const rightIsUnknown = right.rootPath === UNKNOWN_WORKSPACE_GROUP_ID;
      if (leftIsUnknown !== rightIsUnknown) {
        return leftIsUnknown ? 1 : -1;
      }

      const scoreDelta =
        getRootMatchScore(left.rootPath, activeRoots, savedRoots)
        - getRootMatchScore(right.rootPath, activeRoots, savedRoots);
      if (scoreDelta !== 0) return scoreDelta;

      const rightUpdatedAt = right.entries[0]?.session.updatedAt ?? 0;
      const leftUpdatedAt = left.entries[0]?.session.updatedAt ?? 0;
      return rightUpdatedAt - leftUpdatedAt;
    });

  const groups: CodexSessionGroup[] = [];
  const flattened: CodexSessionSummary[] = [];
  let totalMatchedSessions = 0;

  for (const group of orderedGroups) {
    totalMatchedSessions += group.totalCount;

    if (flattened.length >= limit) {
      continue;
    }

    const visibleSessions = group.entries
      .slice(0, perGroupLimit)
      .map((entry) => entry.session)
      .slice(0, Math.max(0, limit - flattened.length));

    if (visibleSessions.length === 0) {
      continue;
    }

    groups.push({
      id: group.rootPath,
      label: getWorkspaceLabel(group.rootPath),
      rootPath: group.rootPath,
      isActive: activeRoots.has(group.rootPath),
      isCollapsed: collapsedGroups.has(group.rootPath),
      hiddenSessionCount: Math.max(group.totalCount - visibleSessions.length, 0),
      sessions: visibleSessions,
    });

    flattened.push(...visibleSessions);
  }

  const latestUpdatedAt = flattened.reduce<number | null>(
    (latest, session) => {
      if (!session.updatedAt) return latest;
      return latest == null || session.updatedAt > latest ? session.updatedAt : latest;
    },
    null,
  );

  return {
    sessions: flattened,
    groups,
    latestUpdatedAt,
    totalMatchedSessions,
    totalVisibleSessions: flattened.length,
  };
}

function mergeSessionSummary(
  base: CodexSessionSummary | null | undefined,
  overlay: CodexSessionSummary | null | undefined,
): CodexSessionSummary | null {
  if (!base && !overlay) return null;
  if (!base) return overlay ?? null;
  if (!overlay) return base;

  const pickPreferredThreadName = (
    primary: string | null | undefined,
    secondary: string | null | undefined,
  ) => {
    const score = (value: string | null | undefined) => {
      const title = value?.trim() ?? "";
      if (!title) return Number.POSITIVE_INFINITY;

      let total = 0;
      if (title.includes("\n")) total += 4;
      if (title.length > 120) total += 2;
      if (title.includes("/Users/")) total += 1;
      if (title.includes("What I want from you:")) total += 3;
      if (title.includes("Deliverables:")) total += 3;
      if (title.includes("Execution style:")) total += 3;
      return total;
    };

    const primaryScore = score(primary);
    const secondaryScore = score(secondary);

    if (primaryScore < secondaryScore) return primary ?? null;
    if (secondaryScore < primaryScore) return secondary ?? null;

    const primaryLength = primary?.trim().length ?? Number.POSITIVE_INFINITY;
    const secondaryLength = secondary?.trim().length ?? Number.POSITIVE_INFINITY;
    if (primaryLength <= secondaryLength) return primary ?? secondary ?? null;
    return secondary ?? primary ?? null;
  };

  return {
    sessionId: overlay.sessionId,
    threadName: pickPreferredThreadName(base.threadName, overlay.threadName),
    updatedAt: Math.max(base.updatedAt ?? 0, overlay.updatedAt ?? 0) || null,
    cwd: overlay.cwd ?? base.cwd,
    model: overlay.model ?? base.model,
    source: overlay.source ?? base.source,
    isSubagent: overlay.isSubagent ?? base.isSubagent ?? false,
    cliVersion: overlay.cliVersion ?? base.cliVersion,
    lastMessagePreview: overlay.lastMessagePreview ?? base.lastMessagePreview,
    transcriptPath: overlay.transcriptPath ?? base.transcriptPath,
  };
}

function mergeSessionSummaries(
  fileBackedSessions: CodexSessionSummary[],
  mirroredSessions: CodexSessionSummary[],
) {
  const byId = new Map<string, CodexSessionSummary>();

  for (const session of fileBackedSessions) {
    byId.set(session.sessionId, session);
  }

  for (const session of mirroredSessions) {
    const merged = mergeSessionSummary(byId.get(session.sessionId), session);
    if (merged) {
      byId.set(session.sessionId, merged);
    }
  }

  return [...byId.values()].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function mergeSessionEvents(
  baseEvents: FileCodexSessionEvent[],
  overlayEvents: CodexSessionEvent[],
) {
  const DUPLICATE_WINDOW_MS = 5_000;
  const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
  const signatureFor = (event: CodexSessionEvent) =>
    [
      event.role,
      event.rawType,
      event.phase ?? "",
      normalizeText(event.text),
    ].join("|");

  const dedupeKeyFor = (event: CodexSessionEvent) => {
    const timestampBucket = event.timestamp == null
      ? "none"
      : `${Math.floor(event.timestamp / DUPLICATE_WINDOW_MS)}`;

    return `${signatureFor(event)}|${timestampBucket}`;
  };

  const byId = new Map<string, CodexSessionEvent>();
  const seenSemanticKeys = new Set<string>();

  for (const event of baseEvents) {
    byId.set(event.id, event);
    seenSemanticKeys.add(dedupeKeyFor(event));
  }

  for (const event of overlayEvents) {
    if (!byId.has(event.id) && seenSemanticKeys.has(dedupeKeyFor(event))) {
      continue;
    }

    byId.set(event.id, event);
    seenSemanticKeys.add(dedupeKeyFor(event));
  }

  return [...byId.values()].sort((left, right) => {
    const leftTimestamp = left.timestamp ?? 0;
    const rightTimestamp = right.timestamp ?? 0;
    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function listVisibleCodexSessions(limit = 20): Promise<VisibleCodexSessionsResult> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), DEFAULT_DISCOVERY_LIMIT));
  const discoveryLimit = Math.max(
    safeLimit,
    Math.min(DEFAULT_DISCOVERY_LIMIT, safeLimit * DEFAULT_VISIBLE_GROUP_SESSION_LIMIT),
  );
  const [fileBackedSessions, mirroredSessions, sidebarState] = await Promise.all([
    listCodexSessions({ limit: discoveryLimit }),
    listCodexMirroredSessions(discoveryLimit),
    readCodexDesktopSidebarState(),
  ]);
  const sessions = mergeSessionSummaries(fileBackedSessions, mirroredSessions);

  const visible = buildVisibleCodexSessionGroups(sessions, [], sidebarState, {
    limit: safeLimit,
  });
  return visible;
}

export async function getVisibleCodexSessionDetail(sessionId: string): Promise<CodexSessionDetail | null> {
  const lifecycleState = await reconcileCodexMirrorSession(sessionId);
  if (lifecycleState === "archived") {
    return null;
  }

  const [mirroredResult, fileResult, indexedResult] = await Promise.allSettled([
    getCodexMirroredSessionDetail(sessionId),
    getCodexSessionDetail(sessionId),
    listCodexSessionIndexSummariesById([sessionId]),
  ]);

  const mirrored = mirroredResult.status === "fulfilled" ? mirroredResult.value : null;
  const fileBacked = fileResult.status === "fulfilled" ? fileResult.value : null;
  const indexed = indexedResult.status === "fulfilled"
    ? indexedResult.value.find((session) => session.sessionId === sessionId) ?? null
    : null;

  if (!mirrored && !fileBacked && !indexed) {
    return null;
  }

  if (lifecycleState === "missing" && !fileBacked) {
    return null;
  }

  if (!mirrored && !fileBacked) {
    return null;
  }

  if (!mirrored) {
    const detail = fileBacked
      ? {
          ...mergeSessionSummary(fileBacked, indexed) ?? fileBacked,
          events: fileBacked.events,
        }
      : null;
    if (detail) {
      await syncCodexMirrorThreadFromSession(detail);
    }
    return detail;
  }

  if (!fileBacked) {
    if (lifecycleState === "missing") {
      return null;
    }

    const detail = mirrored
      ? {
          ...mergeSessionSummary(mirrored, indexed) ?? mirrored,
          events: mirrored.events,
        }
      : null;
    if (detail) {
      await syncCodexMirrorThreadFromSession(detail);
    }
    return detail;
  }

  const summary = mergeSessionSummary(
    mergeSessionSummary(fileBacked, mirrored),
    indexed,
  ) ?? mirrored;
  const events = mergeSessionEvents(fileBacked.events, mirrored.events);

  const detail = {
    ...summary,
    events,
  };

  await syncCodexMirrorThreadFromSession(detail);
  return detail;
}

export async function waitForVisibleCodexSessionDetail(
  sessionId: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<CodexSessionDetail> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 150;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const session = await getVisibleCodexSessionDetail(sessionId);
      if (session) return session;
      throw new Error(`Codex session ${sessionId} not found`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Codex session ${sessionId} not found`);
}
