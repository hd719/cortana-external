import { Client } from "pg";
import { getTaskPrisma } from "@/lib/task-prisma";
import {
  deleteEpicFromApp,
  deleteTaskFromApp,
  upsertEpicFromSource,
  upsertTaskFromSource,
} from "@/lib/task-sync";

type ListenerPayload = {
  table: "cortana_tasks" | "cortana_epics";
  op: "INSERT" | "UPDATE" | "DELETE";
  id: number;
};

type ListenerStatus = {
  enabled: boolean;
  started: boolean;
  connected: boolean;
  reconnectAttempts: number;
  lastEventAt: string | null;
  lastError: string | null;
};

const TASK_CHANGE_CHANNEL = "task_change";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

const globalForTaskListener = globalThis as typeof globalThis & {
  missionControlTaskListener?: {
    started: boolean;
    connected: boolean;
    reconnectAttempts: number;
    lastEventAt: string | null;
    lastError: string | null;
    stopRequested: boolean;
    reconnectTimer?: NodeJS.Timeout;
    client?: Client;
  };
};

const state =
  globalForTaskListener.missionControlTaskListener ??
  (globalForTaskListener.missionControlTaskListener = {
    started: false,
    connected: false,
    reconnectAttempts: 0,
    lastEventAt: null,
    lastError: null,
    stopRequested: false,
  });

const listenerEnabled = () => process.env.DISABLE_TASK_LISTENER !== "true";

const connectionString =
  process.env.CORTANA_DATABASE_URL?.trim() || "postgresql://localhost:5432/cortana";

const parsePayload = (payload: string): ListenerPayload | null => {
  try {
    const parsed = JSON.parse(payload) as Partial<ListenerPayload>;
    if (
      (parsed.table === "cortana_tasks" || parsed.table === "cortana_epics") &&
      (parsed.op === "INSERT" || parsed.op === "UPDATE" || parsed.op === "DELETE") &&
      typeof parsed.id === "number"
    ) {
      return parsed as ListenerPayload;
    }
  } catch {
    return null;
  }

  return null;
};

const syncEvent = async (event: ListenerPayload) => {
  const source = getTaskPrisma();
  if (!source) {
    state.lastError = "Task source unavailable (CORTANA_DATABASE_URL / DATABASE_URL misconfigured).";
    return;
  }

  if (event.table === "cortana_tasks") {
    if (event.op === "DELETE") {
      await deleteTaskFromApp(event.id);
    } else {
      const synced = await upsertTaskFromSource(source, event.id);
      if (!synced) {
        await deleteTaskFromApp(event.id);
      }
    }
    return;
  }

  if (event.op === "DELETE") {
    await deleteEpicFromApp(event.id);
  } else {
    const synced = await upsertEpicFromSource(source, event.id);
    if (!synced) {
      await deleteEpicFromApp(event.id);
    }
  }
};

const scheduleReconnect = () => {
  if (state.stopRequested || !listenerEnabled()) return;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }

  state.reconnectAttempts += 1;
  const waitMs = Math.min(
    RECONNECT_BASE_MS * 2 ** Math.max(0, state.reconnectAttempts - 1),
    RECONNECT_MAX_MS
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void connectAndListen();
  }, waitMs);
};

const teardownClient = async () => {
  const current = state.client;
  state.client = undefined;
  state.connected = false;

  if (!current) return;

  try {
    await current.end();
  } catch {
    // noop
  }
};

const connectAndListen = async () => {
  if (state.stopRequested || !listenerEnabled()) return;

  await teardownClient();

  const client = new Client({ connectionString });

  client.on("notification", (message) => {
    if (message.channel !== TASK_CHANGE_CHANNEL || !message.payload) return;

    const parsed = parsePayload(message.payload);
    if (!parsed) return;

    state.lastEventAt = new Date().toISOString();

    void syncEvent(parsed).catch((error) => {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error("Task listener sync failed", error);
    });
  });

  client.on("error", (error) => {
    state.connected = false;
    state.lastError = error.message;
    console.error("Task listener connection error", error);
    scheduleReconnect();
  });

  client.on("end", () => {
    state.connected = false;
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${TASK_CHANGE_CHANNEL}`);

    state.client = client;
    state.connected = true;
    state.reconnectAttempts = 0;
    state.lastError = null;
  } catch (error) {
    state.connected = false;
    state.lastError = error instanceof Error ? error.message : String(error);
    scheduleReconnect();
  }
};

export const startTaskListener = async () => {
  if (!listenerEnabled() || state.started) return;

  state.started = true;
  state.stopRequested = false;
  await connectAndListen();
};

export const stopTaskListener = async () => {
  state.stopRequested = true;
  state.started = false;
  state.connected = false;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = undefined;
  }

  await teardownClient();
};

export const getTaskListenerStatus = (): ListenerStatus => ({
  enabled: listenerEnabled(),
  started: state.started,
  connected: state.connected,
  reconnectAttempts: state.reconnectAttempts,
  lastEventAt: state.lastEventAt,
  lastError: state.lastError,
});
