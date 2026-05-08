import { beforeEach, describe, expect, it, vi } from "vitest";

const codexMocks = vi.hoisted(() => ({
  getVisibleCodexSessionDetail: vi.fn(),
  renameCodexThread: vi.fn(),
  syncCodexMirrorThreadFromSession: vi.fn(),
  upsertCodexSessionIndexEntry: vi.fn(),
  archiveCodexSession: vi.fn(),
  deleteCodexSession: vi.fn(),
}));

vi.mock("@/lib/codex-session-access", () => ({
  getVisibleCodexSessionDetail: codexMocks.getVisibleCodexSessionDetail,
}));

vi.mock("@/lib/codex-sessions", () => ({
  upsertCodexSessionIndexEntry: codexMocks.upsertCodexSessionIndexEntry,
  archiveCodexSession: codexMocks.archiveCodexSession,
  deleteCodexSession: codexMocks.deleteCodexSession,
}));

vi.mock("@/lib/codex-app-server", () => ({
  renameCodexThread: codexMocks.renameCodexThread,
}));

vi.mock("@/lib/codex-mirror", () => ({
  syncCodexMirrorThreadFromSession: codexMocks.syncCodexMirrorThreadFromSession,
}));

import { DELETE, GET, PATCH } from "@/app/api/codex/sessions/[sessionId]/route";

describe("GET /api/codex/sessions/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session detail", async () => {
    codexMocks.getVisibleCodexSessionDetail.mockResolvedValueOnce({
      sessionId: "abc",
      threadName: "Brainstorm",
      updatedAt: 123,
      cwd: "/Users/hd/Developer/cortana-external",
      model: "gpt-5.4",
      source: "exec",
      cliVersion: "0.121.0",
      lastMessagePreview: "Latest",
      transcriptPath: "/tmp/session.jsonl",
      events: [
        { id: "0:user", role: "user", text: "Hi", timestamp: 100, phase: null, rawType: "user_message" },
        { id: "1:assistant", role: "assistant", text: "Hello", timestamp: 200, phase: null, rawType: "agent_message" },
      ],
    });

    const response = await GET(new Request("http://localhost/api/codex/sessions/abc"), {
      params: Promise.resolve({ sessionId: "abc" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.sessionId).toBe("abc");
    expect(payload.session.events).toEqual([
      { id: "0:user", role: "user", text: "Hi", timestamp: 100, phase: null, rawType: "user_message" },
      { id: "1:assistant", role: "assistant", text: "Hello", timestamp: 200, phase: null, rawType: "agent_message" },
    ]);
    expect(payload.pagination).toEqual({
      totalEvents: 2,
      loadedEvents: 2,
      hasMore: false,
      nextBefore: null,
      rangeStart: 0,
      rangeEnd: 2,
    });
    expect(codexMocks.getVisibleCodexSessionDetail).toHaveBeenCalledWith("abc");
  });

  it("returns the latest event page by default and older events with before cursors", async () => {
    codexMocks.getVisibleCodexSessionDetail.mockResolvedValue({
      sessionId: "abc",
      threadName: "Brainstorm",
      updatedAt: 123,
      cwd: "/Users/hd/Developer/cortana-external",
      model: "gpt-5.4",
      source: "exec",
      cliVersion: "0.121.0",
      lastMessagePreview: "Latest",
      transcriptPath: "/tmp/session.jsonl",
      events: Array.from({ length: 4 }, (_, index) => ({
        id: `${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `message-${index}`,
        timestamp: 100 + index,
        phase: null,
        rawType: "event_msg",
      })),
    });

    const latestResponse = await GET(new Request("http://localhost/api/codex/sessions/abc?limit=2"), {
      params: Promise.resolve({ sessionId: "abc" }),
    });
    const latestPayload = await latestResponse.json();

    expect(latestResponse.status).toBe(200);
    expect(latestPayload.session.events.map((event: { id: string }) => event.id)).toEqual(["2", "3"]);
    expect(latestPayload.pagination).toEqual({
      totalEvents: 4,
      loadedEvents: 2,
      hasMore: true,
      nextBefore: 2,
      rangeStart: 2,
      rangeEnd: 4,
    });

    const olderResponse = await GET(new Request("http://localhost/api/codex/sessions/abc?limit=2&before=2"), {
      params: Promise.resolve({ sessionId: "abc" }),
    });
    const olderPayload = await olderResponse.json();

    expect(olderPayload.session.events.map((event: { id: string }) => event.id)).toEqual(["0", "1"]);
    expect(olderPayload.pagination).toEqual({
      totalEvents: 4,
      loadedEvents: 2,
      hasMore: false,
      nextBefore: null,
      rangeStart: 0,
      rangeEnd: 2,
    });
  });

  it("returns 404 when the session is missing", async () => {
    codexMocks.getVisibleCodexSessionDetail.mockRejectedValueOnce(new Error("Codex session abc not found"));

    const response = await GET(new Request("http://localhost/api/codex/sessions/abc"), {
      params: Promise.resolve({ sessionId: "abc" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain("not found");
  });
});

describe("PATCH /api/codex/sessions/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives a session", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" }),
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(codexMocks.archiveCodexSession).toHaveBeenCalledWith("abc");
    expect(payload).toEqual({ ok: true, sessionId: "abc", action: "archive" });
  });

  it("renames a session", async () => {
    codexMocks.getVisibleCodexSessionDetail.mockResolvedValueOnce({
      sessionId: "abc",
      threadName: "Old title",
      updatedAt: 123,
      cwd: "/Users/hd/Developer/cortana-external",
      model: "gpt-5.4",
      source: "exec",
      cliVersion: "0.121.0",
      lastMessagePreview: "Latest",
      transcriptPath: "/tmp/session.jsonl",
      events: [],
    });

    const response = await PATCH(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "rename", threadName: "  Better   title  " }),
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(codexMocks.renameCodexThread).toHaveBeenCalledWith("abc", "Better title");
    expect(codexMocks.upsertCodexSessionIndexEntry).toHaveBeenCalledWith({
      id: "abc",
      threadName: "Better title",
      updatedAt: 123,
    });
    expect(codexMocks.syncCodexMirrorThreadFromSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "abc", threadName: "Better title" }),
    );
    expect(payload).toEqual({
      ok: true,
      sessionId: "abc",
      action: "rename",
      session: expect.objectContaining({ sessionId: "abc", threadName: "Better title" }),
    });
  });

  it("rejects an empty rename title", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "rename", threadName: "   " }),
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );

    expect(response.status).toBe(400);
    expect(codexMocks.renameCodexThread).not.toHaveBeenCalled();
  });

  it("returns 404 when renaming a missing session", async () => {
    codexMocks.getVisibleCodexSessionDetail.mockResolvedValueOnce(null);

    const response = await PATCH(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "rename", threadName: "Better title" }),
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );

    expect(response.status).toBe(404);
    expect(codexMocks.renameCodexThread).not.toHaveBeenCalled();
  });

  it("rejects unsupported actions", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "noop" }),
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );

    expect(response.status).toBe(400);
    expect(codexMocks.archiveCodexSession).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/codex/sessions/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a session transcript", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/codex/sessions/abc", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ sessionId: "abc" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(codexMocks.deleteCodexSession).toHaveBeenCalledWith("abc");
    expect(payload).toEqual({ ok: true, sessionId: "abc", action: "delete" });
  });
});
