import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const CLIENT_NAME = "mission-control";
const CLIENT_TITLE = "Mission Control";
const CLIENT_VERSION = "0.0.0";
const DEFAULT_REASONING_EFFORT = "low";

type JsonRpcNotification = {
  method?: string;
  params?: Record<string, unknown>;
};

export type CodexAppServerNotification = JsonRpcNotification & {
  method: string;
  params: Record<string, unknown>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationListener = (notification: CodexAppServerNotification) => void;

type ThreadStartResult = {
  thread: {
    id: string;
  };
};

type ThreadResumeResult = {
  thread: {
    id: string;
  };
};

type TurnStartResult = {
  turn: {
    id: string;
  };
};

export type MissionControlCodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started"; thread_id: string; turn_id: string }
  | { type: "item.delta"; item: { type: "agent_message"; id: string; delta: string } }
  | { type: "item.completed"; item: { type: "agent_message"; id: string; text: string } };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNotificationThreadId(notification: CodexAppServerNotification): string | null {
  if (notification.method === "thread/started") {
    return asString(asRecord(notification.params.thread)?.id);
  }

  return asString(notification.params.threadId);
}

function normalizeNotification(notification: CodexAppServerNotification): MissionControlCodexEvent | null {
  if (notification.method === "thread/started") {
    const threadId = asString(asRecord(notification.params.thread)?.id);
    return threadId ? { type: "thread.started", thread_id: threadId } : null;
  }

  if (notification.method === "turn/started") {
    const threadId = asString(notification.params.threadId);
    const turnId = asString(asRecord(notification.params.turn)?.id);
    return threadId && turnId ? { type: "turn.started", thread_id: threadId, turn_id: turnId } : null;
  }

  if (notification.method === "item/agentMessage/delta") {
    const itemId = asString(notification.params.itemId);
    const delta = asString(notification.params.delta);
    return itemId && delta
      ? {
          type: "item.delta",
          item: {
            type: "agent_message",
            id: itemId,
            delta,
          },
        }
      : null;
  }

  if (notification.method === "item/completed") {
    const item = asRecord(notification.params.item);
    if (!item || item.type !== "agentMessage") {
      return null;
    }

    const itemId = asString(item.id);
    const text = asString(item.text);
    return itemId && text
      ? {
          type: "item.completed",
          item: {
            type: "agent_message",
            id: itemId,
            text,
          },
        }
      : null;
  }

  return null;
}

function buildThreadName(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled Codex session";
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationListeners = new Set<NotificationListener>();
  private stdoutBuffer = "";
  private initializePromise: Promise<void> | null = null;

  private spawnServer() {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.flushStdout();
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // App-server logs are noisy and not actionable for the Mission Control route.
    });

    child.on("error", (error) => {
      this.failPendingRequests(error);
      this.resetProcess();
    });

    child.on("close", (code) => {
      const error = new Error(code === null ? "Codex app-server exited" : `Codex app-server exited with code ${code}`);
      this.failPendingRequests(error);
      this.resetProcess();
    });

    this.child = child;
  }

  private resetProcess() {
    this.child = null;
    this.stdoutBuffer = "";
    this.initializePromise = null;
  }

  private failPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private flushStdout() {
    let boundary = this.stdoutBuffer.indexOf("\n");
    while (boundary !== -1) {
      const line = this.stdoutBuffer.slice(0, boundary).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(boundary + 1);
      if (line) {
        this.handleMessage(line);
      }
      boundary = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleMessage(rawLine: string) {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      return;
    }

    const responseId = typeof parsed.id === "number" ? parsed.id : null;
    if (responseId !== null) {
      const pending = this.pendingRequests.get(responseId);
      if (!pending) return;

      this.pendingRequests.delete(responseId);
      const error = asRecord(parsed.error);
      if (error) {
        pending.reject(new Error(asString(error.message) ?? "Codex app-server request failed"));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    const method = asString(parsed.method);
    const params = asRecord(parsed.params);
    if (!method || !params) {
      return;
    }

    const notification: CodexAppServerNotification = {
      method,
      params,
    };
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  private async ensureInitialized() {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    if (!this.child) {
      this.spawnServer();
    }

    this.initializePromise = this.request("initialize", {
      clientInfo: {
        name: CLIENT_NAME,
        title: CLIENT_TITLE,
        version: CLIENT_VERSION,
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: ["rawResponseItem/completed"],
      },
    })
      .then(() => undefined)
      .catch((error) => {
        this.initializePromise = null;
        throw error;
      });

    return this.initializePromise;
  }

  private async request(method: string, params: Record<string, unknown> | undefined) {
    await this.ensureWritableProcess();

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.child?.stdin.write(`${payload}\n`);
    return responsePromise;
  }

  private async ensureWritableProcess() {
    if (!this.child) {
      this.spawnServer();
    }
  }

  private addNotificationListener(listener: NotificationListener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  async startThread(prompt: string, cwd: string) {
    await this.ensureInitialized();

    const response = (await this.request("thread/start", {
      cwd,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })) as ThreadStartResult;

    const threadId = asString(response.thread?.id);
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id");
    }

    await this.request("thread/name/set", {
      threadId,
      name: buildThreadName(prompt),
    });

    return { threadId };
  }

  async resumeThread(threadId: string) {
    await this.ensureInitialized();

    const response = (await this.request("thread/resume", {
      threadId,
      persistExtendedHistory: true,
    })) as ThreadResumeResult;

    const resumedThreadId = asString(response.thread?.id);
    if (!resumedThreadId) {
      throw new Error(`Codex app-server could not resume thread ${threadId}`);
    }
  }

  async setThreadName(threadId: string, prompt: string) {
    await this.ensureInitialized();
    await this.resumeThread(threadId);
    await this.request("thread/name/set", {
      threadId,
      name: buildThreadName(prompt),
    });
  }

  async renameThread(threadId: string, name: string) {
    await this.ensureInitialized();
    await this.resumeThread(threadId);
    await this.request("thread/name/set", {
      threadId,
      name,
    });
  }

  async streamTurn(options: {
    threadId: string;
    prompt: string;
    cwd?: string | null;
    signal?: AbortSignal;
    onEvent?: (event: MissionControlCodexEvent) => void;
    onNotification?: (notification: CodexAppServerNotification) => void;
  }) {
    await this.ensureInitialized();

    const { threadId, prompt, cwd, signal, onEvent, onNotification } = options;
    let activeTurnId: string | null = null;
    let settled = false;

    return new Promise<{ turnId: string | null }>((resolve, reject) => {
      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener("abort", handleAbort);
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const handleAbort = () => {
        settle(() => {
          const error = new Error("Codex stream aborted");
          error.name = "AbortError";
          reject(error);
        });
      };

      const unsubscribe = this.addNotificationListener((notification) => {
        if (getNotificationThreadId(notification) !== threadId) {
          return;
        }

        onNotification?.(notification);

        const normalized = normalizeNotification(notification);
        if (normalized) {
          onEvent?.(normalized);
        }

        if (notification.method === "turn/started") {
          const turnId = asString(asRecord(notification.params.turn)?.id);
          if (turnId) {
            activeTurnId = turnId;
          }
          return;
        }

        if (notification.method === "error") {
          const notificationTurnId = asString(notification.params.turnId);
          if (!activeTurnId || !notificationTurnId || notificationTurnId === activeTurnId) {
            settle(() => reject(new Error(asString(asRecord(notification.params.error)?.message) ?? "Codex turn failed")));
          }
          return;
        }

        if (notification.method === "turn/completed") {
          const notificationTurnId = asString(asRecord(notification.params.turn)?.id);
          if (!activeTurnId || !notificationTurnId || notificationTurnId === activeTurnId) {
            settle(() => resolve({ turnId: notificationTurnId ?? activeTurnId }));
          }
        }
      });

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      signal?.addEventListener("abort", handleAbort, { once: true });

      void this.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
        ],
        cwd: cwd ?? undefined,
        effort: DEFAULT_REASONING_EFFORT,
      })
        .then((response) => {
          activeTurnId = asString((response as TurnStartResult).turn?.id) ?? activeTurnId;
        })
        .catch((error) => {
          settle(() => reject(error instanceof Error ? error : new Error("Failed to start Codex turn")));
        });
    });
  }
}

declare global {
  var __missionControlCodexAppServer__: CodexAppServerClient | undefined;
}

function getClient() {
  if (!globalThis.__missionControlCodexAppServer__) {
    globalThis.__missionControlCodexAppServer__ = new CodexAppServerClient();
  }

  return globalThis.__missionControlCodexAppServer__;
}

export async function createCodexThread(prompt: string, cwd: string, options?: {
  signal?: AbortSignal;
  onEvent?: (event: MissionControlCodexEvent) => void;
  onNotification?: (notification: CodexAppServerNotification) => void;
}) {
  const client = getClient();
  const { threadId } = await client.startThread(prompt, cwd);
  options?.onEvent?.({ type: "thread.started", thread_id: threadId });
  await client.streamTurn({
    threadId,
    prompt,
    cwd,
    signal: options?.signal,
    onEvent: options?.onEvent,
    onNotification: options?.onNotification,
  });
  return { threadId };
}

export async function replyToCodexThread(
  threadId: string,
  prompt: string,
  cwd: string,
  options?: {
    signal?: AbortSignal;
    onEvent?: (event: MissionControlCodexEvent) => void;
    onNotification?: (notification: CodexAppServerNotification) => void;
  },
) {
  const client = getClient();
  await client.resumeThread(threadId);
  await client.streamTurn({
    threadId,
    prompt,
    cwd,
    signal: options?.signal,
    onEvent: options?.onEvent,
    onNotification: options?.onNotification,
  });
}

export async function backfillCodexThreadName(threadId: string, prompt: string) {
  const client = getClient();
  await client.setThreadName(threadId, prompt);
}

export async function renameCodexThread(threadId: string, name: string) {
  const client = getClient();
  await client.renameThread(threadId, name);
}
