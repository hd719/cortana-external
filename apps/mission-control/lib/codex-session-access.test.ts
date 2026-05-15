// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const codexMirrorMocks = vi.hoisted(() => ({
  getCodexMirroredSessionDetail: vi.fn(),
  listCodexMirroredSessions: vi.fn(),
  reconcileCodexMirrorSession: vi.fn(),
  reconcileCodexMirrorSessions: vi.fn(),
  syncCodexMirrorThreadFromSession: vi.fn(),
}));

const codexSessionMocks = vi.hoisted(() => ({
  getCodexSessionDetail: vi.fn(),
  listCodexSessions: vi.fn(),
  listCodexSessionIndexSummariesById: vi.fn(),
}));

vi.mock("@/lib/codex-mirror", () => ({
  getCodexMirroredSessionDetail: codexMirrorMocks.getCodexMirroredSessionDetail,
  listCodexMirroredSessions: codexMirrorMocks.listCodexMirroredSessions,
  reconcileCodexMirrorSession: codexMirrorMocks.reconcileCodexMirrorSession,
  reconcileCodexMirrorSessions: codexMirrorMocks.reconcileCodexMirrorSessions,
  syncCodexMirrorThreadFromSession: codexMirrorMocks.syncCodexMirrorThreadFromSession,
}));

vi.mock("@/lib/codex-sessions", () => ({
  getCodexSessionDetail: codexSessionMocks.getCodexSessionDetail,
  listCodexSessions: codexSessionMocks.listCodexSessions,
  listCodexSessionIndexSummariesById: codexSessionMocks.listCodexSessionIndexSummariesById,
}));

import {
  buildVisibleCodexSessionGroups,
  getVisibleCodexSessionDetail,
  listVisibleCodexSessions,
} from "@/lib/codex-session-access";

describe("buildVisibleCodexSessionGroups", () => {
  it("keeps spawned worker threads visible and groups sessions by workspace root", () => {
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "visible",
          threadName: "Brainstorm Codex web interface",
          updatedAt: 300,
          cwd: "/Users/hd/Developer/cortana-external",
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.121.0",
          lastMessagePreview: "Ship Mission Control parity",
          transcriptPath: "/tmp/visible.jsonl",
        },
        {
          sessionId: "spawned",
          threadName: "Investigate streamer contract",
          updatedAt: 250,
          cwd: "/Users/hd/Developer/cortana-external",
          model: "gpt-5.4-mini",
          source: "{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"root\"}}}",
          cliVersion: "0.121.0",
          lastMessagePreview: "Worker lane",
          transcriptPath: "/tmp/spawned.jsonl",
        },
        {
          sessionId: "utility",
          threadName: "sessions",
          updatedAt: 200,
          cwd: "/Users/hd/Developer/cortana-external/apps/mission-control/scripts",
          model: "gpt-5.4",
          source: "cli",
          cliVersion: "0.121.0",
          lastMessagePreview: "helper",
          transcriptPath: "/tmp/utility.jsonl",
        },
      ],
      [
        {
          id: "visible",
          title: "Brainstorm Codex web interface",
          cwd: "/Users/hd/Developer/cortana-external",
          source: "vscode",
          first_user_message: "Ship Mission Control parity",
          archived: 0,
          has_user_event: 0,
          updated_at_ms: 300,
        },
        {
          id: "spawned",
          title: "Investigate streamer contract",
          cwd: "/Users/hd/Developer/cortana-external",
          source: "{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"root\"}}}",
          first_user_message: "Investigate streamer contract",
          archived: 0,
          has_user_event: 0,
          updated_at_ms: 250,
        },
        {
          id: "utility",
          title: "sessions",
          cwd: "/Users/hd/Developer/cortana-external/apps/mission-control/scripts",
          source: "cli",
          first_user_message: "",
          archived: 0,
          has_user_event: 0,
          updated_at_ms: 200,
        },
      ],
      {
        activeWorkspaceRoots: ["/Users/hd/Developer/cortana-external"],
        savedWorkspaceRoots: ["/Users/hd/Developer/cortana"],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.totalMatchedSessions).toBe(2);
    expect(result.totalVisibleSessions).toBe(2);
    expect(result.groups).toEqual([
      expect.objectContaining({
        id: "/Users/hd/Developer/cortana-external",
        label: "cortana-external",
        isActive: true,
      }),
    ]);
    expect(result.sessions.map((session) => session.sessionId)).toEqual(["visible", "spawned"]);
  });

  it("groups sessions without any resolved workspace context under Other", () => {
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "unknown-context",
          threadName: "Reply with exactly: ack-two",
          updatedAt: 300,
          cwd: null,
          model: null,
          source: null,
          cliVersion: null,
          lastMessagePreview: null,
          transcriptPath: null,
        },
        {
          sessionId: "known-context",
          threadName: "Brainstorm Codex web interface",
          updatedAt: 250,
          cwd: "/Users/hd/Developer/cortana-external",
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.121.0",
          lastMessagePreview: "Visible in project rail",
          transcriptPath: "/tmp/known.jsonl",
        },
      ],
      [
        {
          id: "unknown-context",
          title: "Reply with exactly: ack-two",
          cwd: null,
          source: null,
          first_user_message: "Reply with exactly: ack-two",
          archived: 0,
          has_user_event: 1,
          updated_at_ms: 300,
        },
        {
          id: "known-context",
          title: "Brainstorm Codex web interface",
          cwd: "/Users/hd/Developer/cortana-external",
          source: "vscode",
          first_user_message: "Brainstorm Codex web interface",
          archived: 0,
          has_user_event: 1,
          updated_at_ms: 250,
        },
      ],
      {
        activeWorkspaceRoots: ["/Users/hd/Developer/cortana-external"],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.totalMatchedSessions).toBe(2);
    expect(result.totalVisibleSessions).toBe(2);
    expect(result.sessions.map((session) => session.sessionId)).toEqual(["known-context", "unknown-context"]);
    expect(result.groups).toEqual([
      expect.objectContaining({
        id: "/Users/hd/Developer/cortana-external",
        label: "cortana-external",
      }),
      expect.objectContaining({
        id: "__unknown_codex_workspace__",
        label: "Other",
      }),
    ]);
  });

  it("shows interactive and exec sessions in the project rail", () => {
    const repoRoot = "/Users/hd/Developer/cortana-external";
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "exec-session",
          threadName: "Inspect Mission Control API health",
          updatedAt: 500,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "exec",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/tmp/exec.jsonl",
        },
        {
          sessionId: "interactive-session",
          threadName: "Locate backtester v8-v10 PRDs",
          updatedAt: 400,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/tmp/interactive.jsonl",
        },
      ],
      [
        {
          id: "exec-session",
          title: "Inspect Mission Control API health",
          cwd: repoRoot,
          source: "exec",
          first_user_message: "Inspect Mission Control API health",
          archived: 0,
          has_user_event: 1,
          updated_at_ms: 500,
        },
        {
          id: "interactive-session",
          title: "Locate backtester v8-v10 PRDs",
          cwd: repoRoot,
          source: "vscode",
          first_user_message: "Hey check the cortana-external repo for some PRDs",
          archived: 0,
          has_user_event: 1,
          updated_at_ms: 400,
        },
      ],
      {
        activeWorkspaceRoots: [repoRoot],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["exec-session", "interactive-session"]);
  });

  it("matches workspace roots case-insensitively on macOS paths", () => {
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "cortana-session",
          threadName: "Check backtester cron firing",
          updatedAt: 500,
          cwd: "/users/hd/developer/cortana",
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.116.0",
          lastMessagePreview: "I found the OpenClaw cron source.",
          transcriptPath: "/Users/hd/.codex/sessions/2026/04/07/rollout-cortana-session.jsonl",
        },
      ],
      [],
      {
        activeWorkspaceRoots: ["/Users/hd/Developer/cortana-external"],
        savedWorkspaceRoots: ["/Users/hd/Developer/cortana"],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.groups).toEqual([
      expect.objectContaining({
        id: "/Users/hd/Developer/cortana",
        label: "cortana",
      }),
    ]);
    expect(result.sessions.map((session) => session.sessionId)).toEqual(["cortana-session"]);
  });

  it("hides sessions whose transcript already lives in archived_sessions", () => {
    const repoRoot = "/Users/hd/Developer/cortana-external";
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "archived-session",
          threadName: "Already archived",
          updatedAt: 500,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/Users/hd/.codex/archived_sessions/rollout-archived-session.jsonl",
        },
        {
          sessionId: "visible-session",
          threadName: "Still active",
          updatedAt: 400,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/Users/hd/.codex/sessions/2026/04/23/rollout-visible-session.jsonl",
        },
      ],
      [],
      {
        activeWorkspaceRoots: [repoRoot],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["visible-session"]);
    expect(result.totalMatchedSessions).toBe(1);
  });

  it("hides synthetic named vscode threads that never captured a user message", () => {
    const repoRoot = "/Users/hd/Developer/cortana-external";
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "synthetic-session",
          threadName: "MC visibility test",
          updatedAt: 500,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/tmp/synthetic.jsonl",
        },
        {
          sessionId: "real-session",
          threadName: "Verify repo purpose",
          updatedAt: 400,
          cwd: repoRoot,
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: "We should show this session",
          transcriptPath: "/tmp/real.jsonl",
        },
      ],
      [
        {
          id: "synthetic-session",
          title: "MC visibility test",
          cwd: repoRoot,
          source: "vscode",
          first_user_message: "",
          archived: 0,
          has_user_event: 0,
          updated_at_ms: 500,
        },
        {
          id: "real-session",
          title: "Verify repo purpose",
          cwd: repoRoot,
          source: "vscode",
          first_user_message: "Tell me what this repo is for",
          archived: 0,
          has_user_event: 1,
          updated_at_ms: 400,
        },
      ],
      {
        activeWorkspaceRoots: [repoRoot],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      },
      { limit: 20, homeDir: "/Users/hd" },
    );

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["real-session"]);
  });
});

describe("listVisibleCodexSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codexMirrorMocks.syncCodexMirrorThreadFromSession.mockResolvedValue(undefined);
    codexMirrorMocks.listCodexMirroredSessions.mockResolvedValue([]);
    codexSessionMocks.listCodexSessions.mockResolvedValue([]);
    codexSessionMocks.listCodexSessionIndexSummariesById.mockResolvedValue([]);
  });

  it("uses .codex-backed sessions without syncing the sidebar list into the mirror", async () => {
    const repoRoot = path.join(os.homedir(), "Developer", "cortana-external");
    codexSessionMocks.listCodexSessions.mockResolvedValueOnce([
      {
        sessionId: "abc",
        threadName: "Visible title",
        updatedAt: 200,
        cwd: repoRoot,
        model: "gpt-5.4",
        source: "vscode",
        cliVersion: "0.121.0",
        lastMessagePreview: "file preview",
        transcriptPath: "/tmp/file.jsonl",
      },
    ]);

    const result = await listVisibleCodexSessions(10);

    expect(codexSessionMocks.listCodexSessions).toHaveBeenCalledWith({ limit: 50 });
    expect(codexMirrorMocks.listCodexMirroredSessions).toHaveBeenCalledWith(50);
    expect(result.sessions).toEqual([
      {
        sessionId: "abc",
        threadName: "Visible title",
        updatedAt: 200,
        cwd: repoRoot,
        model: "gpt-5.4",
        source: "vscode",
        cliVersion: "0.121.0",
        lastMessagePreview: "file preview",
        transcriptPath: "/tmp/file.jsonl",
      },
    ]);
    expect(result.totalVisibleSessions).toBe(1);
    expect(codexMirrorMocks.syncCodexMirrorThreadFromSession).not.toHaveBeenCalled();
  });

  it("shows active mirrored sessions before the transcript index catches up", async () => {
    const repoRoot = path.join(os.homedir(), "Developer", "cortana-external");
    codexMirrorMocks.listCodexMirroredSessions.mockResolvedValueOnce([
      {
        sessionId: "active-stream",
        threadName: "You are reviewing a Market Lab trading artifact",
        updatedAt: 400,
        cwd: repoRoot,
        model: "gpt-5.5",
        source: "exec",
        cliVersion: "0.126.0",
        lastMessagePreview: "Codex is reading the packet.",
        transcriptPath: null,
      },
    ]);

    const result = await listVisibleCodexSessions(10);

    expect(result.sessions).toEqual([
      expect.objectContaining({
        sessionId: "active-stream",
        cwd: repoRoot,
        source: "exec",
      }),
    ]);
    expect(result.totalVisibleSessions).toBe(1);
  });

  it("keeps older valid sessions when they are present in .codex discovery", async () => {
    const repoRoot = path.join(os.homedir(), "Developer", "cortana-external");
    codexSessionMocks.listCodexSessions.mockResolvedValueOnce([
      {
        sessionId: "recent",
        threadName: "Investigate missing Codex chat",
        updatedAt: 300,
        cwd: repoRoot,
        model: "gpt-5.4",
        source: "vscode",
        cliVersion: "0.122.0",
        lastMessagePreview: "Newest visible session",
        transcriptPath: "/tmp/recent.jsonl",
      },
      {
        sessionId: "older",
        threadName: "Check backtester cron firing",
        updatedAt: 100,
        cwd: path.join(os.homedir(), "Developer", "cortana"),
        model: "gpt-5.4",
        source: "vscode",
        cliVersion: "0.122.0",
        lastMessagePreview: "Older but still visible",
        transcriptPath: "/tmp/older.jsonl",
      },
    ]);

    const result = await listVisibleCodexSessions(10);

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["recent", "older"]);
  });

  it("shows sessions without workspace metadata under Other instead of dropping them", async () => {
    const result = buildVisibleCodexSessionGroups(
      [
        {
          sessionId: "unknown",
          threadName: "Trace cooldown run branch",
          updatedAt: 500,
          cwd: null,
          model: null,
          source: null,
          cliVersion: null,
          lastMessagePreview: null,
          transcriptPath: null,
        },
        {
          sessionId: "known",
          threadName: "Inspect AGENTS.md",
          updatedAt: 400,
          cwd: path.join(os.homedir(), "Developer", "cortana"),
          model: "gpt-5.4",
          source: "vscode",
          cliVersion: "0.122.0",
          lastMessagePreview: null,
          transcriptPath: "/tmp/known.jsonl",
        },
      ],
      [],
      {
        activeWorkspaceRoots: [],
        savedWorkspaceRoots: [],
        collapsedGroups: [],
      },
      { limit: 10 },
    );

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["known", "unknown"]);
    expect(result.groups).toEqual([
      expect.objectContaining({
        id: path.join(os.homedir(), "Developer", "cortana"),
        label: "cortana",
      }),
      expect.objectContaining({
        id: "__unknown_codex_workspace__",
        label: "Other",
      }),
    ]);
  });
});

describe("getVisibleCodexSessionDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codexMirrorMocks.syncCodexMirrorThreadFromSession.mockResolvedValue(undefined);
  });

  it("returns null when the session was archived outside Mission Control", async () => {
    codexMirrorMocks.reconcileCodexMirrorSession.mockResolvedValueOnce("archived");

    const session = await getVisibleCodexSessionDetail("abc");

    expect(session).toBeNull();
    expect(codexSessionMocks.getCodexSessionDetail).not.toHaveBeenCalled();
  });

  it("returns file-backed detail when the mirror lifecycle is missing but the transcript still exists", async () => {
    codexMirrorMocks.reconcileCodexMirrorSession.mockResolvedValueOnce("missing");
    codexMirrorMocks.getCodexMirroredSessionDetail.mockResolvedValueOnce(null);
    codexSessionMocks.getCodexSessionDetail.mockResolvedValueOnce({
      sessionId: "orphan-file-session",
      threadName: "Recover orphan transcript",
      updatedAt: 250,
      cwd: "/Users/hd/Developer/cortana",
      model: "gpt-5.4",
      source: "vscode",
      cliVersion: "0.122.0",
      lastMessagePreview: "Recovered from transcript",
      transcriptPath: "/Users/hd/.codex/sessions/2026/04/21/rollout-orphan-file-session.jsonl",
      events: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "Recovered from transcript",
          timestamp: 250,
          phase: null,
          rawType: "assistant.message",
        },
      ],
    });
    codexSessionMocks.listCodexSessionIndexSummariesById.mockResolvedValueOnce([
      {
        sessionId: "orphan-file-session",
        threadName: "Recover orphan transcript",
        updatedAt: 250,
        cwd: null,
        model: null,
        source: null,
        isSubagent: false,
        cliVersion: null,
        lastMessagePreview: null,
        transcriptPath: null,
      },
    ]);

    const session = await getVisibleCodexSessionDetail("orphan-file-session");

    expect(session).toEqual(
      expect.objectContaining({
        sessionId: "orphan-file-session",
        threadName: "Recover orphan transcript",
      }),
    );
    expect(codexMirrorMocks.syncCodexMirrorThreadFromSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "orphan-file-session",
      }),
    );
  });

  it("merges mirrored and file-backed detail for active sessions", async () => {
    codexMirrorMocks.reconcileCodexMirrorSession.mockResolvedValueOnce("active");
    codexMirrorMocks.getCodexMirroredSessionDetail.mockResolvedValueOnce({
      sessionId: "abc",
      threadName: "Mirror title",
      updatedAt: 200,
      cwd: null,
      model: "gpt-5.4",
      source: "vscode",
      cliVersion: "0.121.0",
      lastMessagePreview: "mirror preview",
      transcriptPath: "/tmp/mirror.jsonl",
      events: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "Hello",
          timestamp: 200,
          phase: "final_answer",
          rawType: "agent_message",
        },
      ],
    });
    codexSessionMocks.getCodexSessionDetail.mockResolvedValueOnce({
      sessionId: "abc",
      threadName: "File title",
      updatedAt: 150,
      cwd: "/tmp/workspace",
      model: null,
      source: null,
      cliVersion: null,
      lastMessagePreview: "file preview",
      transcriptPath: "/tmp/file.jsonl",
      events: [
        {
          id: "user-1",
          role: "user",
          text: "Hi",
          timestamp: 100,
          phase: null,
          rawType: "user_message",
        },
      ],
    });

    const session = await getVisibleCodexSessionDetail("abc");

    expect(session).toEqual({
      sessionId: "abc",
      threadName: "File title",
      updatedAt: 200,
      cwd: "/tmp/workspace",
      model: "gpt-5.4",
      source: "vscode",
      isSubagent: false,
      cliVersion: "0.121.0",
      lastMessagePreview: "mirror preview",
      transcriptPath: "/tmp/mirror.jsonl",
      events: [
        {
          id: "user-1",
          role: "user",
          text: "Hi",
          timestamp: 100,
          phase: null,
          rawType: "user_message",
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "Hello",
          timestamp: 200,
          phase: "final_answer",
          rawType: "agent_message",
        },
      ],
    });
    expect(codexMirrorMocks.syncCodexMirrorThreadFromSession).toHaveBeenCalledWith(session);
  });

  it("prefers the indexed session title when mirrored detail keeps a long raw prompt", async () => {
    codexMirrorMocks.reconcileCodexMirrorSession.mockResolvedValueOnce("active");
    codexMirrorMocks.getCodexMirroredSessionDetail.mockResolvedValueOnce({
      sessionId: "poly",
      threadName:
        "Read this PRD first: /Users/hd/Developer/cortana/docs/prd-polymarket-market-intelligence.md\nI want you to implement this in TypeScript inside the `cortana-external` repository.",
      updatedAt: 300,
      cwd: "/Users/hd/Developer/cortana-external",
      model: "gpt-5.4",
      source: "vscode",
      cliVersion: "0.122.0",
      lastMessagePreview: "mirror preview",
      transcriptPath: "/tmp/poly-mirror.jsonl",
      events: [],
    });
    codexSessionMocks.getCodexSessionDetail.mockResolvedValueOnce({
      sessionId: "poly",
      threadName:
        "Read this PRD first: /Users/hd/Developer/cortana/docs/prd-polymarket-market-intelligence.md",
      updatedAt: 200,
      cwd: "/Users/hd/Developer/cortana-external",
      model: null,
      source: null,
      cliVersion: null,
      lastMessagePreview: null,
      transcriptPath: "/tmp/poly-file.jsonl",
      events: [],
    });
    codexSessionMocks.listCodexSessionIndexSummariesById.mockResolvedValueOnce([
      {
        sessionId: "poly",
        threadName: "Add Polymarket intelligence layer",
        updatedAt: 100,
        cwd: "/Users/hd/Developer/cortana-external",
        model: null,
        source: null,
        cliVersion: null,
        lastMessagePreview: null,
        transcriptPath: null,
      },
    ]);

    const session = await getVisibleCodexSessionDetail("poly");

    expect(session).toEqual(
      expect.objectContaining({
        sessionId: "poly",
        threadName: "Add Polymarket intelligence layer",
        updatedAt: 300,
      }),
    );
  });
});
