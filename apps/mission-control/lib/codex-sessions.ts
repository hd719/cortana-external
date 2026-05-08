import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_CODEX_ROOT = path.join(os.homedir(), ".codex");
const DEFAULT_SESSION_INDEX_PATH = path.join(DEFAULT_CODEX_ROOT, "session_index.jsonl");
const DEFAULT_SESSIONS_ROOT = path.join(DEFAULT_CODEX_ROOT, "sessions");
const DEFAULT_ARCHIVED_ROOT = path.join(DEFAULT_CODEX_ROOT, "archived_sessions");
const DEFAULT_CODEX_STATE_DB_PATH = path.join(DEFAULT_CODEX_ROOT, "state_5.sqlite");
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SIDEBAR_METADATA_READ_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);

export type CodexSessionSummary = {
  sessionId: string;
  threadName: string | null;
  updatedAt: number | null;
  cwd: string | null;
  model: string | null;
  source: string | null;
  isSubagent?: boolean;
  cliVersion: string | null;
  lastMessagePreview: string | null;
  transcriptPath: string | null;
};

export type CodexSessionEvent = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number | null;
  phase: string | null;
  rawType: string;
};

export type CodexSessionDetail = CodexSessionSummary & {
  events: CodexSessionEvent[];
};

type SessionIndexEntry = {
  id: string;
  threadName: string | null;
  updatedAt: number | null;
};

type TranscriptMetadata = {
  cwd: string | null;
  model: string | null;
  source: string | null;
  isSubagent: boolean;
  cliVersion: string | null;
  lastMessagePreview: string | null;
};

type ListCodexSessionsOptions = {
  limit?: number | null;
  sessionIds?: string[] | null;
  sessionIndexPath?: string;
  sessionsRoot?: string;
  archivedRoot?: string;
  stateDbPath?: string;
};

type CodexSessionLookupOptions = Omit<ListCodexSessionsOptions, "limit">;

type UnindexedCodexSession = {
  sessionId: string;
  threadName: string;
  transcriptPath: string;
};

type CodexStateThreadRow = {
  id: string;
  title: string | null;
  cwd: string | null;
  source: string | null;
  cli_version: string | null;
  model: string | null;
  rollout_path: string | null;
  updated_at_ms: number | null;
};

function truncatePreview(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringifyJsonValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isSubagentSourceValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    return value.includes("thread_spawn") || value.includes("\"subagent\"");
  }

  return stringifyJsonValue(value)?.includes("thread_spawn")
    || stringifyJsonValue(value)?.includes("\"subagent\"")
    || false;
}

function clampLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function parseJsonLine(rawLine: string): Record<string, unknown> | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseCodexSessionIndex(raw: string): SessionIndexEntry[] {
  const sortedEntries = raw
    .split(/\r?\n/)
    .map(parseJsonLine)
    .flatMap((record) => {
      if (!record) return [];

      const id = parseString(record.id);
      if (!id) return [];

      return [
        {
          id,
          threadName: parseString(record.thread_name),
          updatedAt: parseTimestamp(record.updated_at),
        },
      ];
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const entriesById = new Map<string, SessionIndexEntry>();
  for (const entry of sortedEntries) {
    const existing = entriesById.get(entry.id);
    if (!existing) {
      entriesById.set(entry.id, entry);
      continue;
    }

    if (!existing.threadName && entry.threadName) {
      entriesById.set(entry.id, {
        ...existing,
        threadName: entry.threadName,
      });
    }
  }

  return [...entriesById.values()]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function serializeSessionIndexEntry(entry: SessionIndexEntry) {
  return JSON.stringify({
    id: entry.id,
    thread_name: entry.threadName,
    updated_at: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
  });
}

export async function upsertCodexSessionIndexEntry(
  entry: SessionIndexEntry,
  options: Pick<ListCodexSessionsOptions, "sessionIndexPath"> = {},
) {
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;

  let raw = "";
  try {
    raw = await fs.readFile(sessionIndexPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : null;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const mergedEntries = new Map<string, SessionIndexEntry>(
    parseCodexSessionIndex(raw).map((existing) => [existing.id, existing]),
  );

  const existing = mergedEntries.get(entry.id);
  mergedEntries.set(entry.id, {
    id: entry.id,
    threadName: entry.threadName ?? existing?.threadName ?? null,
    updatedAt: entry.updatedAt ?? existing?.updatedAt ?? Date.now(),
  });

  const serialized = [...mergedEntries.values()]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map(serializeSessionIndexEntry)
    .join("\n");

  await fs.writeFile(sessionIndexPath, serialized.length > 0 ? `${serialized}\n` : "", "utf8");
}

export async function removeCodexSessionIndexEntry(
  sessionId: string,
  options: Pick<ListCodexSessionsOptions, "sessionIndexPath"> = {},
) {
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;

  let raw = "";
  try {
    raw = await fs.readFile(sessionIndexPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : null;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  const remaining = parseCodexSessionIndex(raw).filter((entry) => entry.id !== sessionId);
  const serialized = remaining
    .map(serializeSessionIndexEntry)
    .join("\n");

  await fs.writeFile(sessionIndexPath, serialized.length > 0 ? `${serialized}\n` : "", "utf8");
}

export async function listCodexSessionIndexSummaries(
  options: Pick<ListCodexSessionsOptions, "limit" | "sessionIndexPath"> = {},
): Promise<CodexSessionSummary[]> {
  const limit = clampLimit(options.limit);
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const raw = await fs.readFile(sessionIndexPath, "utf8");

  return parseCodexSessionIndex(raw)
    .slice(0, limit)
    .map((entry) => ({
      sessionId: entry.id,
      threadName: entry.threadName,
      updatedAt: entry.updatedAt,
      cwd: null,
      model: null,
      source: null,
      isSubagent: false,
      cliVersion: null,
      lastMessagePreview: null,
      transcriptPath: null,
    }));
}

export async function listCodexSessionIndexSummariesById(
  sessionIds: string[],
  options: Pick<ListCodexSessionsOptions, "sessionIndexPath"> = {},
): Promise<CodexSessionSummary[]> {
  const requestedIds = new Set(
    sessionIds
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  if (requestedIds.size === 0) {
    return [];
  }

  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const raw = await fs.readFile(sessionIndexPath, "utf8");

  return parseCodexSessionIndex(raw)
    .filter((entry) => requestedIds.has(entry.id))
    .map((entry) => ({
      sessionId: entry.id,
      threadName: entry.threadName,
      updatedAt: entry.updatedAt,
      cwd: null,
      model: null,
      source: null,
      isSubagent: false,
      cliVersion: null,
      lastMessagePreview: null,
      transcriptPath: null,
    }));
}

export async function listCodexStateThreadSummaries(
  options: { limit?: number | null; stateDbPath?: string } = {},
): Promise<CodexSessionSummary[]> {
  const limit = clampLimit(options.limit);
  const stateDbPath = options.stateDbPath ?? DEFAULT_CODEX_STATE_DB_PATH;

  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [
        "-json",
        stateDbPath,
        `
          SELECT
            id,
            title,
            cwd,
            source,
            cli_version,
            model,
            rollout_path,
            COALESCE(updated_at_ms, updated_at * 1000) AS updated_at_ms
          FROM threads
          WHERE archived = 0
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC
          LIMIT ${escapeSqlLiteral(String(limit))}
        `,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );

    if (!stdout.trim()) {
      return [];
    }

    const rows = JSON.parse(stdout) as CodexStateThreadRow[];
    return rows.map((row) => ({
      sessionId: parseString(row.id) ?? "",
      threadName: parseString(row.title),
      updatedAt: parseTimestamp(row.updated_at_ms),
      cwd: parseString(row.cwd),
      model: parseString(row.model),
      source: parseString(row.source),
      isSubagent: isSubagentSourceValue(row.source),
      cliVersion: parseString(row.cli_version),
      lastMessagePreview: null,
      transcriptPath: parseString(row.rollout_path),
    })).filter((row) => row.sessionId.length > 0);
  } catch {
    return [];
  }
}

export function parseCodexTranscriptMetadata(raw: string): TranscriptMetadata {
  const metadata: TranscriptMetadata = {
    cwd: null,
    model: null,
    source: null,
    isSubagent: false,
    cliVersion: null,
    lastMessagePreview: null,
  };

  for (const line of raw.split(/\r?\n/)) {
    const record = parseJsonLine(line);
    if (!record) continue;

    if (record.type === "session_meta") {
      const payload = record.payload;
      if (payload && typeof payload === "object") {
        const typed = payload as Record<string, unknown>;
        metadata.cwd = parseString(typed.cwd) ?? metadata.cwd;
        metadata.source =
          parseString(typed.source) ??
          stringifyJsonValue(typed.source) ??
          parseString(typed.originator) ??
          metadata.source;
        metadata.isSubagent = metadata.isSubagent
          || isSubagentSourceValue(typed.source)
          || parseString(typed.forked_from_id) != null;
        metadata.cliVersion = parseString(typed.cli_version) ?? metadata.cliVersion;
        metadata.model = parseString(typed.model) ?? metadata.model;
      }
      continue;
    }

    if (record.type === "turn_context") {
      const payload = record.payload;
      if (payload && typeof payload === "object") {
        const typed = payload as Record<string, unknown>;
        metadata.cwd = parseString(typed.cwd) ?? metadata.cwd;
        metadata.model = parseString(typed.model) ?? metadata.model;
      }
      continue;
    }

    if (record.type !== "event_msg") continue;

    const payload = record.payload;
    if (!payload || typeof payload !== "object") continue;

    const typed = payload as Record<string, unknown>;
    const payloadType = parseString(typed.type);
    if (payloadType !== "user_message" && payloadType !== "agent_message" && payloadType !== "task_complete") {
      continue;
    }

    const message =
      parseString(typed.message) ??
      parseString(typed.last_agent_message);

    if (message) {
      metadata.lastMessagePreview = truncatePreview(message);
    }
  }

  return metadata;
}

async function readCodexTranscriptMetadataForSidebar(transcriptPath: string): Promise<TranscriptMetadata> {
  const file = await fs.open(transcriptPath, "r");

  try {
    const buffer = Buffer.alloc(SIDEBAR_METADATA_READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) {
      return {
        cwd: null,
        model: null,
        source: null,
        isSubagent: false,
        cliVersion: null,
        lastMessagePreview: null,
      };
    }

    return parseCodexTranscriptMetadata(buffer.toString("utf8", 0, bytesRead));
  } finally {
    await file.close();
  }
}

export function parseCodexTranscriptEvents(raw: string): CodexSessionEvent[] {
  const events: CodexSessionEvent[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const record = parseJsonLine(line);
    if (!record || record.type !== "event_msg") continue;

    const payload = record.payload;
    if (!payload || typeof payload !== "object") continue;

    const typed = payload as Record<string, unknown>;
    const payloadType = parseString(typed.type);
    const message = parseString(typed.message);

    if (payloadType === "user_message" && message) {
      events.push({
        id: `${events.length}:user`,
        role: "user",
        text: message,
        timestamp: parseTimestamp(record.timestamp),
        phase: null,
        rawType: payloadType,
      });
      continue;
    }

    if (payloadType === "agent_message" && message) {
      events.push({
        id: `${events.length}:assistant`,
        role: "assistant",
        text: message,
        timestamp: parseTimestamp(record.timestamp),
        phase: parseString(typed.phase),
        rawType: payloadType,
      });
    }
  }

  return events;
}

function parseFirstUserMessage(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const record = parseJsonLine(line);
    if (!record || record.type !== "event_msg") continue;

    const payload = record.payload;
    if (!payload || typeof payload !== "object") continue;

    const typed = payload as Record<string, unknown>;
    if (typed.type !== "user_message") continue;

    const message = parseString(typed.message);
    if (message) return message;
  }

  return null;
}

function buildThreadName(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled Codex session";
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

function extractSessionIdFromTranscriptFile(entry: string) {
  const match = entry.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

async function readDailyTranscriptFiles(directoryPath: string) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

export async function listUnindexedCodexSessions(
  options: CodexSessionLookupOptions & { limit?: number; lookbackDays?: number } = {},
): Promise<UnindexedCodexSession[]> {
  const limit = clampLimit(options.limit);
  const lookbackDays = Math.max(1, Math.min(options.lookbackDays ?? 2, 7));
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;

  const rawIndex = await fs.readFile(sessionIndexPath, "utf8");
  const indexedSessionIds = new Set(parseCodexSessionIndex(rawIndex).map((entry) => entry.id));

  const candidatePaths: string[] = [];
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - offset);
    const directoryPath = path.join(
      sessionsRoot,
      String(day.getUTCFullYear()),
      String(day.getUTCMonth() + 1).padStart(2, "0"),
      String(day.getUTCDate()).padStart(2, "0"),
    );
    candidatePaths.push(...(await readDailyTranscriptFiles(directoryPath)));
  }

  const recentPaths = candidatePaths.sort().reverse();
  const results: UnindexedCodexSession[] = [];

  for (const transcriptPath of recentPaths) {
    if (results.length >= limit) break;

    const sessionId = extractSessionIdFromTranscriptFile(path.basename(transcriptPath));
    if (!sessionId || indexedSessionIds.has(sessionId)) continue;

    const rawTranscript = await fs.readFile(transcriptPath, "utf8");
    const firstUserMessage = parseFirstUserMessage(rawTranscript);
    if (!firstUserMessage) continue;

    results.push({
      sessionId,
      threadName: buildThreadName(firstUserMessage),
      transcriptPath,
    });
  }

  return results;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findTranscriptPathFromStateDb(
  sessionId: string,
  stateDbPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [
        "-json",
        stateDbPath,
        `
          SELECT rollout_path
          FROM threads
          WHERE id = '${escapeSqlLiteral(sessionId)}'
          LIMIT 1
        `,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );

    if (!stdout.trim()) {
      return null;
    }

    const rows = JSON.parse(stdout) as Array<{ rollout_path?: string | null }>;
    const rolloutPath = parseString(rows[0]?.rollout_path);
    return rolloutPath && await fileExists(rolloutPath) ? rolloutPath : null;
  } catch {
    return null;
  }
}

type CodexThreadStateRow = {
  id: string;
  title: string | null;
  cwd: string | null;
  source: string | null;
  cli_version: string | null;
  model: string | null;
  rollout_path: string | null;
  archived: number | null;
  updated_at_ms: number | null;
};

async function getCodexThreadStateRow(
  sessionId: string,
  stateDbPath: string,
): Promise<CodexThreadStateRow | null> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [
        "-json",
        stateDbPath,
        `
          SELECT
            id,
            title,
            cwd,
            source,
            cli_version,
            model,
            rollout_path,
            archived,
            COALESCE(updated_at_ms, updated_at * 1000) AS updated_at_ms
          FROM threads
          WHERE id = '${escapeSqlLiteral(sessionId)}'
          LIMIT 1
        `,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );

    if (!stdout.trim()) {
      return null;
    }

    const rows = JSON.parse(stdout) as CodexThreadStateRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function findTranscriptPath(
  sessionId: string,
  updatedAt: number | null,
  sessionsRoot: string,
  archivedRoot: string,
  stateDbPath: string,
): Promise<string | null> {
  if (updatedAt) {
    const updatedDate = new Date(updatedAt);
    if (!Number.isNaN(updatedDate.getTime())) {
      const dailyDir = path.join(
        sessionsRoot,
        String(updatedDate.getUTCFullYear()),
        String(updatedDate.getUTCMonth() + 1).padStart(2, "0"),
        String(updatedDate.getUTCDate()).padStart(2, "0"),
      );

      try {
        const entries = await fs.readdir(dailyDir);
        const match = entries.find((entry) => entry.includes(sessionId) && entry.endsWith(".jsonl"));
        if (match) return path.join(dailyDir, match);
      } catch {
        // Daily folder missing is acceptable; fall through to archive scan.
      }
    }
  }

  const stateDbTranscriptPath = await findTranscriptPathFromStateDb(sessionId, stateDbPath);
  if (stateDbTranscriptPath) {
    return stateDbTranscriptPath;
  }

  try {
    const archivedEntries = await fs.readdir(archivedRoot);
    const archivedMatch = archivedEntries.find((entry) => entry.includes(sessionId) && entry.endsWith(".jsonl"));
    if (archivedMatch) return path.join(archivedRoot, archivedMatch);
  } catch {
    // Archived sessions are optional.
  }

  return null;
}

async function enrichSessionEntry(
  entry: SessionIndexEntry,
  sessionsRoot: string,
  archivedRoot: string,
  stateDbPath: string,
): Promise<CodexSessionSummary | null> {
  const transcriptPath = await findTranscriptPath(entry.id, entry.updatedAt, sessionsRoot, archivedRoot, stateDbPath);
  if (!transcriptPath || !(await fileExists(transcriptPath))) {
    return null;
  }

  const metadata = await readCodexTranscriptMetadataForSidebar(transcriptPath);

  return {
    sessionId: entry.id,
    threadName: entry.threadName,
    updatedAt: entry.updatedAt ?? null,
    cwd: metadata.cwd,
    model: metadata.model,
    source: metadata.source,
    isSubagent: metadata.isSubagent,
    cliVersion: metadata.cliVersion,
    lastMessagePreview: metadata.lastMessagePreview,
    transcriptPath,
  };
}

export async function listCodexSessions(options: ListCodexSessionsOptions = {}): Promise<CodexSessionSummary[]> {
  const limit = clampLimit(options.limit);
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const archivedRoot = options.archivedRoot ?? DEFAULT_ARCHIVED_ROOT;
  const stateDbPath = options.stateDbPath ?? DEFAULT_CODEX_STATE_DB_PATH;
  const requestedIds = new Set(
    (options.sessionIds ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );

  const raw = await fs.readFile(sessionIndexPath, "utf8");
  const parsedEntries = parseCodexSessionIndex(raw);
  const entries = requestedIds.size > 0
    ? parsedEntries.filter((entry) => requestedIds.has(entry.id))
    : parsedEntries;

  const sessions: CodexSessionSummary[] = [];
  for (const entry of entries) {
    if (sessions.length >= limit) {
      break;
    }

    const enriched = await enrichSessionEntry(entry, sessionsRoot, archivedRoot, stateDbPath);
    if (enriched) {
      sessions.push(enriched);
    }
  }

  return sessions;
}

export async function getCodexSessionDetail(
  sessionId: string,
  options: CodexSessionLookupOptions = {},
): Promise<CodexSessionDetail> {
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const archivedRoot = options.archivedRoot ?? DEFAULT_ARCHIVED_ROOT;
  const stateDbPath = options.stateDbPath ?? DEFAULT_CODEX_STATE_DB_PATH;

  const rawIndex = await fs.readFile(sessionIndexPath, "utf8");
  const entry = parseCodexSessionIndex(rawIndex).find((item) => item.id === sessionId) ?? {
    id: sessionId,
    threadName: null,
    updatedAt: Date.now(),
  };

  const transcriptPath = await findTranscriptPath(entry.id, entry.updatedAt, sessionsRoot, archivedRoot, stateDbPath);
  if (!transcriptPath || !(await fileExists(transcriptPath))) {
    throw new Error(`Codex session ${sessionId} not found`);
  }

  const rawTranscript = await fs.readFile(transcriptPath, "utf8");
  const metadata = parseCodexTranscriptMetadata(rawTranscript);
  const events = parseCodexTranscriptEvents(rawTranscript);
  const latestEvent = events.at(-1)?.timestamp ?? null;

  return {
    sessionId: entry.id,
    threadName: entry.threadName,
    updatedAt: Math.max(entry.updatedAt ?? 0, latestEvent ?? 0) || null,
    cwd: metadata.cwd,
    model: metadata.model,
    source: metadata.source,
    isSubagent: metadata.isSubagent,
    cliVersion: metadata.cliVersion,
    lastMessagePreview: metadata.lastMessagePreview,
    transcriptPath,
    events,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCodexSessionDetail(
  sessionId: string,
  options: CodexSessionLookupOptions & { attempts?: number; delayMs?: number } = {},
): Promise<CodexSessionDetail> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 200;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await getCodexSessionDetail(sessionId, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Codex session ${sessionId} not found`);
}

async function archiveCodexTranscriptFile(
  transcriptPath: string | null,
  archivedRoot: string,
) {
  if (!transcriptPath || !(await fileExists(transcriptPath))) {
    return null;
  }

  await fs.mkdir(archivedRoot, { recursive: true });
  const sourcePath = path.resolve(transcriptPath);
  if (sourcePath.startsWith(path.resolve(archivedRoot) + path.sep)) {
    return sourcePath;
  }

  let destinationPath = path.join(archivedRoot, path.basename(sourcePath));
  if (destinationPath === sourcePath) {
    return destinationPath;
  }

  if (await fileExists(destinationPath)) {
    destinationPath = path.join(
      archivedRoot,
      `${path.basename(sourcePath, ".jsonl")}-${Date.now()}.jsonl`,
    );
  }

  await fs.rename(sourcePath, destinationPath);
  return destinationPath;
}

async function deleteCodexTranscriptFile(transcriptPath: string | null) {
  if (!transcriptPath || !(await fileExists(transcriptPath))) {
    return;
  }

  await fs.unlink(transcriptPath);
}

export async function archiveCodexSession(
  sessionId: string,
  options: CodexSessionLookupOptions = {},
) {
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const archivedRoot = options.archivedRoot ?? DEFAULT_ARCHIVED_ROOT;
  const stateDbPath = options.stateDbPath ?? DEFAULT_CODEX_STATE_DB_PATH;
  const threadRow = await getCodexThreadStateRow(sessionId, stateDbPath);
  if (!threadRow) {
    try {
      const detail = await getCodexSessionDetail(sessionId, {
        sessionIndexPath,
        sessionsRoot,
        archivedRoot,
        stateDbPath,
      });
      await archiveCodexTranscriptFile(detail.transcriptPath, archivedRoot);
    } catch {
      // Fall through to index cleanup for index-only ghosts.
    }
    await removeCodexSessionIndexEntry(sessionId, { sessionIndexPath });
    return;
  }

  const transcriptPath = await findTranscriptPath(
    sessionId,
    threadRow.updated_at_ms ?? null,
    sessionsRoot,
    archivedRoot,
    stateDbPath,
  );
  const archivedTranscriptPath = await archiveCodexTranscriptFile(transcriptPath, archivedRoot);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();

  await execFileAsync(
    "sqlite3",
    [
      stateDbPath,
      `
        UPDATE threads
        SET archived = 1,
            archived_at = ${nowSeconds},
            updated_at_ms = ${nowMs},
            rollout_path = ${archivedTranscriptPath ? `'${escapeSqlLiteral(archivedTranscriptPath)}'` : "rollout_path"}
        WHERE id = '${escapeSqlLiteral(sessionId)}'
      `,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );

  await removeCodexSessionIndexEntry(sessionId, { sessionIndexPath });
}

export async function deleteCodexSession(
  sessionId: string,
  options: CodexSessionLookupOptions = {},
) {
  const sessionIndexPath = options.sessionIndexPath ?? DEFAULT_SESSION_INDEX_PATH;
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const archivedRoot = options.archivedRoot ?? DEFAULT_ARCHIVED_ROOT;
  const stateDbPath = options.stateDbPath ?? DEFAULT_CODEX_STATE_DB_PATH;
  const threadRow = await getCodexThreadStateRow(sessionId, stateDbPath);
  if (!threadRow) {
    try {
      const detail = await getCodexSessionDetail(sessionId, {
        sessionIndexPath,
        sessionsRoot,
        archivedRoot,
        stateDbPath,
      });
      await deleteCodexTranscriptFile(detail.transcriptPath);
    } catch {
      // Fall through to index cleanup for index-only ghosts.
    }
    await removeCodexSessionIndexEntry(sessionId, { sessionIndexPath });
    return;
  }

  const transcriptPath = await findTranscriptPath(
    sessionId,
    threadRow.updated_at_ms ?? null,
    sessionsRoot,
    archivedRoot,
    stateDbPath,
  );
  await deleteCodexTranscriptFile(transcriptPath);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();

  await execFileAsync(
    "sqlite3",
    [
      stateDbPath,
      `
        UPDATE threads
        SET archived = 1,
            archived_at = ${nowSeconds},
            updated_at_ms = ${nowMs}
        WHERE id = '${escapeSqlLiteral(sessionId)}'
      `,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );

  await removeCodexSessionIndexEntry(sessionId, { sessionIndexPath });
}
