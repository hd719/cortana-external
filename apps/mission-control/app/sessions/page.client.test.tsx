import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionsPage from "./page";
import type { CodexSessionDetail } from "./_components/types";

const CWD = "/Users/hd/Developer/cortana-external";
const updatedAt = Date.now();

const baseSession = {
  sessionId: "session-1",
  threadName: "Verify repo purpose",
  updatedAt,
  cwd: CWD,
  model: "gpt-5.4",
  source: "exec",
  cliVersion: "0.122.0",
  lastMessagePreview: "Ready when you are.",
  transcriptPath: "/tmp/session-1.jsonl",
  activeRun: false,
};

const secondSession = {
  sessionId: "session-2",
  threadName: "Inspect AGENTS.md",
  updatedAt: updatedAt - 60_000,
  cwd: "/Users/hd/Developer/cortana",
  model: "gpt-5.4",
  source: "vscode",
  cliVersion: "0.122.0",
  lastMessagePreview: "Docs first.",
  transcriptPath: "/tmp/session-2.jsonl",
  activeRun: false,
};

const baseSessionDetail: CodexSessionDetail = {
  ...baseSession,
  events: [
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "Ready when you are.",
      timestamp: updatedAt,
      phase: null,
      rawType: "assistant.message",
    },
  ],
};

const secondSessionDetail: CodexSessionDetail = {
  ...secondSession,
  events: [
    {
      id: "assistant-2-1",
      role: "assistant" as const,
      text: "Docs first.",
      timestamp: updatedAt - 60_000,
      phase: null,
      rawType: "assistant.message",
    },
  ],
};

const basePagination = {
  totalEvents: 1,
  loadedEvents: 1,
  hasMore: false,
  nextBefore: null,
  rangeStart: 0,
  rangeEnd: 1,
};

type SessionPatchBody = {
  action?: string;
  threadName?: string;
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function sseResponse(session = baseSessionDetail) {
  const body = [
    `event: done`,
    `data: ${JSON.stringify({ session })}`,
    ``,
    ``,
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installFetchMock(options?: {
  onSessionsGet?: (callCount: number) => Promise<Response> | Response;
  onSessionDetailGet?: (sessionId: string, callCount: number) => Promise<Response> | Response;
  onSessionPatch?: (sessionId: string, body: SessionPatchBody) => Promise<Response> | Response;
  onReplyPost?: () => Promise<Response> | Response;
  onSessionDelete?: (sessionId: string) => Promise<Response> | Response;
  onStream?: () => Promise<Response> | Response;
}) {
  let sessionsGetCalls = 0;
  const sessionDetailGetCalls = new Map<string, number>();
  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/codex/sessions" && method === "GET") {
      sessionsGetCalls += 1;
      if (options?.onSessionsGet) {
        return options.onSessionsGet(sessionsGetCalls);
      }
      return jsonResponse({
        sessions: [baseSession, secondSession],
        groups: [
          {
            id: CWD,
            label: "cortana-external",
            rootPath: CWD,
            isActive: true,
            isCollapsed: false,
            sessions: [baseSession],
          },
          {
            id: secondSession.cwd,
            label: "cortana",
            rootPath: secondSession.cwd,
            isActive: false,
            isCollapsed: false,
            sessions: [secondSession],
          },
        ],
        latestUpdatedAt: updatedAt,
        totalMatchedSessions: 2,
        totalVisibleSessions: 2,
      });
    }

    if (url.startsWith("/api/codex/sessions/") && method === "GET") {
      const sessionId = url.match(/\/api\/codex\/sessions\/([^?]+)/)?.[1] ?? null;
      if (sessionId) {
        const nextCount = (sessionDetailGetCalls.get(sessionId) ?? 0) + 1;
        sessionDetailGetCalls.set(sessionId, nextCount);

        if (options?.onSessionDetailGet) {
          return options.onSessionDetailGet(sessionId, nextCount);
        }

        const detail = sessionId === "session-2" ? secondSessionDetail : baseSessionDetail;
        return jsonResponse({ session: detail, pagination: basePagination });
      }
    }

    if (url.startsWith("/api/codex/sessions/") && method === "PATCH") {
      const sessionId = url.match(/\/api\/codex\/sessions\/([^?]+)/)?.[1] ?? null;
      const parsedBody = init?.body && typeof init.body === "string"
        ? JSON.parse(init.body) as SessionPatchBody
        : {};
      const body: SessionPatchBody = {
        action: typeof parsedBody.action === "string" ? parsedBody.action : undefined,
        threadName: typeof parsedBody.threadName === "string" ? parsedBody.threadName : undefined,
      };
      if (sessionId && options?.onSessionPatch) {
        return options.onSessionPatch(sessionId, body);
      }
      return jsonResponse({ ok: true, sessionId, action: body.action });
    }

    if (url === "/api/codex/sessions/session-1/messages" && method === "POST") {
      if (options?.onReplyPost) return options.onReplyPost();
      return jsonResponse({ streamId: "stream-1" }, 202);
    }

    if (url.startsWith("/api/codex/sessions/") && method === "DELETE") {
      const sessionId = url.match(/\/api\/codex\/sessions\/([^?]+)/)?.[1] ?? null;
      if (sessionId && options?.onSessionDelete) {
        return options.onSessionDelete(sessionId);
      }
      return jsonResponse({ ok: true, sessionId, action: "delete" });
    }

    if (url === "/api/codex/streams/stream-1" && method === "GET") {
      if (options?.onStream) return options.onStream();
      return sseResponse({
        ...baseSessionDetail,
        events: [
          ...baseSessionDetail.events,
          {
            id: "user-2",
            role: "user" as const,
            text: "Check the alert state",
            timestamp: updatedAt + 1_000,
            phase: null,
            rawType: "user.message",
          },
          {
            id: "assistant-2",
            role: "assistant" as const,
            text: "Looking at it now.",
            timestamp: updatedAt + 2_000,
            phase: null,
            rawType: "assistant.message",
          },
        ],
      });
    }

    return jsonResponse({ error: `Unhandled request: ${method} ${url}` }, 500);
  });

  return {
    fetchSpy,
    getSessionsGetCalls: () => sessionsGetCalls,
    getSessionDetailGetCalls: (sessionId: string) => sessionDetailGetCalls.get(sessionId) ?? 0,
  };
}

describe("SessionsPage reply composer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears and locks the composer immediately while a reply is in flight", async () => {
    const replyDeferred = createDeferred<Response>();
    installFetchMock({
      onReplyPost: () => replyDeferred.promise,
    });

    render(<SessionsPage />);

    const textarea = (await screen.findByLabelText("Reply message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Check the alert state" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByLabelText("Reply message")).toHaveValue(""));
    expect(screen.getByLabelText("Reply message")).toBeDisabled();
    expect(screen.getByText("Check the alert state")).toBeInTheDocument();

    replyDeferred.resolve(jsonResponse({ streamId: "stream-1" }, 202));

    await waitFor(() => expect(screen.getByText("Looking at it now.")).toBeInTheDocument());
    expect(screen.getByLabelText("Reply message")).toHaveValue("");
    expect(screen.getByLabelText("Reply message")).not.toBeDisabled();
  });

  it("restores the original prompt and shows a friendly message when the session is already busy", async () => {
    const fetchState = installFetchMock({
      onSessionsGet: (callCount) =>
        jsonResponse({
          sessions: [{ ...baseSession, activeRun: callCount > 1 }],
          groups: [
            {
              id: CWD,
              label: "cortana-external",
              rootPath: CWD,
              isActive: true,
              isCollapsed: false,
              sessions: [{ ...baseSession, activeRun: callCount > 1 }],
            },
          ],
          latestUpdatedAt: updatedAt,
          totalMatchedSessions: 1,
          totalVisibleSessions: 1,
        }),
      onReplyPost: () =>
        jsonResponse(
          { error: "Codex session session-1 already has an active run", code: "conflict" },
          409,
        ),
    });

    render(<SessionsPage />);

    const textarea = (await screen.findByLabelText("Reply message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "That's okay keep going" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByLabelText("Reply message")).toHaveValue(""));
    await waitFor(() =>
      expect(screen.getByLabelText("Reply message")).toHaveValue("That's okay keep going"),
    );

    const replyMessage = "Codex is still finishing the previous reply for this thread.";
    expect(await screen.findAllByText(replyMessage)).toHaveLength(1);
    expect(screen.queryByText(/already has an active run/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reply message")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Reply message")).toBeDisabled();
    expect(fetchState.getSessionsGetCalls()).toBeGreaterThanOrEqual(2);
  });

  it("keeps the composer cleared when the stream completes but the session refresh lags", async () => {
    installFetchMock({
      onSessionsGet: (callCount) =>
        callCount === 1
          ? jsonResponse({
              sessions: [baseSession],
              groups: [
                {
                  id: CWD,
                  label: "cortana-external",
                  rootPath: CWD,
                  isActive: true,
                  isCollapsed: false,
                  sessions: [baseSession],
                },
              ],
              latestUpdatedAt: updatedAt,
              totalMatchedSessions: 1,
              totalVisibleSessions: 1,
            })
          : jsonResponse({ error: "Failed to load Codex sessions" }, 500),
    });

    render(<SessionsPage />);

    const textarea = (await screen.findByLabelText("Reply message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Check the alert state" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText("Looking at it now.")).toBeInTheDocument());
    expect(screen.getByLabelText("Reply message")).toHaveValue("");
    expect(screen.getByLabelText("Reply message")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Failed to send message to Codex session")).not.toBeInTheDocument();
  });

  it("keeps the thinking placeholder scoped to the replying thread", async () => {
    const replyDeferred = createDeferred<Response>();
    installFetchMock({
      onReplyPost: () => replyDeferred.promise,
    });

    render(<SessionsPage />);

    const textarea = (await screen.findByLabelText("Reply message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Check the alert state" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Codex is thinking…")).toBeInTheDocument();
    expect(screen.getByLabelText("Reply message")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Open thread Inspect AGENTS.md" }));

    expect(await screen.findByRole("heading", { name: "Inspect AGENTS.md" })).toBeInTheDocument();
    expect(screen.queryByText("Codex is thinking…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reply message")).not.toBeDisabled();

    await act(async () => {
      replyDeferred.resolve(jsonResponse({ streamId: "stream-1" }, 202));
    });
  });

  it("reuses cached transcript detail when switching back to a visited thread", async () => {
    const fetchState = installFetchMock();

    render(<SessionsPage />);

    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchState.getSessionDetailGetCalls("session-1")).toBe(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open thread Inspect AGENTS.md" }));
    expect(await screen.findByRole("heading", { name: "Inspect AGENTS.md" })).toBeInTheDocument();
    expect(fetchState.getSessionDetailGetCalls("session-2")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Open thread Verify repo purpose" }));
    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();
    expect(fetchState.getSessionDetailGetCalls("session-1")).toBe(1);
  });

  it("renames a visible thread from the sidebar", async () => {
    let currentSession = { ...baseSession };
    let currentDetail = { ...baseSessionDetail };
    const patchBodies: SessionPatchBody[] = [];

    installFetchMock({
      onSessionsGet: () =>
        jsonResponse({
          sessions: [currentSession],
          groups: [
            {
              id: CWD,
              label: "cortana-external",
              rootPath: CWD,
              isActive: true,
              isCollapsed: false,
              sessions: [currentSession],
            },
          ],
          latestUpdatedAt: currentSession.updatedAt,
          totalMatchedSessions: 1,
          totalVisibleSessions: 1,
        }),
      onSessionDetailGet: () => jsonResponse({ session: currentDetail, pagination: basePagination }),
      onSessionPatch: (sessionId, body) => {
        patchBodies.push(body);
        const threadName = String(body.threadName);
        currentSession = { ...currentSession, threadName };
        currentDetail = { ...currentDetail, threadName };
        return jsonResponse({
          ok: true,
          sessionId,
          action: "rename",
          session: currentDetail,
        });
      },
    });

    render(<SessionsPage />);

    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename thread" }));
    const input = await screen.findByLabelText("Thread name");
    fireEvent.change(input, { target: { value: "Mission Control rename work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mission Control rename work" })).toBeInTheDocument();
    });
    expect(patchBodies).toEqual([
      {
        action: "rename",
        threadName: "Mission Control rename work",
      },
    ]);
    expect(screen.queryByRole("dialog", { name: "Rename thread" })).not.toBeInTheDocument();
  });

  it("ignores stale transcript responses after a faster thread switch", async () => {
    const delayedSessionTwoDetail = createDeferred<Response>();
    installFetchMock({
      onSessionDetailGet: (sessionId) => {
        if (sessionId === "session-2") {
          return delayedSessionTwoDetail.promise;
        }
        return jsonResponse({ session: baseSessionDetail, pagination: basePagination });
      },
    });

    render(<SessionsPage />);

    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open thread Inspect AGENTS.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Open thread Verify repo purpose" }));

    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();

    await act(async () => {
      delayedSessionTwoDetail.resolve(jsonResponse({ session: secondSessionDetail, pagination: basePagination }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Inspect AGENTS.md" })).not.toBeInTheDocument();
    });
  });

  it("hides the optimistic user bubble once the persisted user message is loaded", async () => {
    let now = updatedAt;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const replyDeferred = createDeferred<Response>();
    const persistedReplyDetail: CodexSessionDetail = {
      ...baseSessionDetail,
      events: [
        ...baseSessionDetail.events,
        {
          id: "user-2",
          role: "user",
          text: "Check the alert state",
          timestamp: updatedAt + 1_000,
          phase: null,
          rawType: "user.message",
        },
      ],
    };

    installFetchMock({
      onReplyPost: () => replyDeferred.promise,
      onSessionDetailGet: (sessionId, callCount) => {
        if (sessionId === "session-1" && callCount > 1) {
          return jsonResponse({ session: persistedReplyDetail, pagination: { ...basePagination, totalEvents: 2, loadedEvents: 2, rangeEnd: 2 } });
        }
        const detail = sessionId === "session-2" ? secondSessionDetail : baseSessionDetail;
        return jsonResponse({ session: detail, pagination: basePagination });
      },
    });

    render(<SessionsPage />);

    const textarea = (await screen.findByLabelText("Reply message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Check the alert state" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Codex is thinking…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open thread Inspect AGENTS.md" }));
    expect(await screen.findByRole("heading", { name: "Inspect AGENTS.md" })).toBeInTheDocument();

    now += 16_000;
    fireEvent.click(screen.getByRole("button", { name: "Open thread Verify repo purpose" }));

    await waitFor(() => {
      expect(screen.getAllByText("Check the alert state")).toHaveLength(1);
    });

    await act(async () => {
      replyDeferred.resolve(jsonResponse({ streamId: "stream-1" }, 202));
    });
  });

  it("does not refetch a deleted active thread before switching to the next session", async () => {
    const fetchState = installFetchMock({
      onSessionsGet: (callCount) => {
        if (callCount === 1) {
          return jsonResponse({
            sessions: [baseSession, secondSession],
            groups: [
              {
                id: CWD,
                label: "cortana-external",
                rootPath: CWD,
                isActive: true,
                isCollapsed: false,
                sessions: [baseSession],
              },
              {
                id: secondSession.cwd,
                label: "cortana",
                rootPath: secondSession.cwd,
                isActive: false,
                isCollapsed: false,
                sessions: [secondSession],
              },
            ],
            latestUpdatedAt: updatedAt,
            totalMatchedSessions: 2,
            totalVisibleSessions: 2,
          });
        }

        return jsonResponse({
          sessions: [secondSession],
          groups: [
            {
              id: secondSession.cwd,
              label: "cortana",
              rootPath: secondSession.cwd,
              isActive: true,
              isCollapsed: false,
              sessions: [secondSession],
            },
          ],
          latestUpdatedAt: secondSession.updatedAt,
          totalMatchedSessions: 1,
          totalVisibleSessions: 1,
        });
      },
      onSessionDelete: (sessionId) => jsonResponse({ ok: true, sessionId, action: "delete" }),
    });

    render(<SessionsPage />);

    expect(await screen.findByRole("heading", { name: "Verify repo purpose" })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchState.getSessionDetailGetCalls("session-1")).toBe(1);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete thread" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Delete thread?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("heading", { name: "Inspect AGENTS.md" })).toBeInTheDocument();
    expect(fetchState.getSessionDetailGetCalls("session-1")).toBe(1);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });
});
