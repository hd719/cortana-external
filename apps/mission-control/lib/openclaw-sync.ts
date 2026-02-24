import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import {
  backfillOpenClawRunAssignments,
  ingestOpenClawLifecycleEvent,
  OpenClawLifecycleStatus,
} from "@/lib/openclaw-bridge";

type OpenClawRunStoreRecord = {
  runId: string;
  label?: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  endedReason?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
  outcome?: { status?: string };
  task?: Prisma.JsonValue;
  agent?: string;
  role?: string;
  assigned_to?: string;
};

type OpenClawRunStore = {
  runs?: Record<string, OpenClawRunStoreRecord>;
};

const DEFAULT_RUN_STORE_PATH = path.join(os.homedir(), ".openclaw", "subagents", "runs.json");
const RUN_STORE_PATH = process.env.OPENCLAW_SUBAGENT_RUNS_PATH || DEFAULT_RUN_STORE_PATH;

let lastSyncAt = 0;
let lastMtimeMs = 0;

const toIso = (timestamp?: number) =>
  timestamp && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;

const toLifecycleStatus = (run: OpenClawRunStoreRecord): OpenClawLifecycleStatus => {
  if (!run.endedAt) {
    return run.startedAt ? "running" : "queued";
  }

  const normalized = (run.outcome?.status || "").toLowerCase();
  if (normalized === "ok" || normalized === "done" || normalized === "completed") return "done";
  if (normalized === "timeout") return "timeout";
  if (normalized === "killed" || normalized === "cancelled" || normalized === "canceled") return "killed";
  if (normalized === "failed" || normalized === "error") return "failed";
  return "done";
};

export async function syncOpenClawRunsFromStore() {
  const now = Date.now();
  if (now - lastSyncAt < 1500) {
    return { synced: 0, skipped: true };
  }

  lastSyncAt = now;

  let stats;
  try {
    stats = await fs.stat(RUN_STORE_PATH);
  } catch {
    return { synced: 0, skipped: true };
  }

  if (stats.mtimeMs <= lastMtimeMs) {
    return { synced: 0, skipped: true };
  }

  const raw = await fs.readFile(RUN_STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as OpenClawRunStore;
  const runRecords = Object.values(parsed.runs || {});

  if (runRecords.length === 0) {
    lastMtimeMs = stats.mtimeMs;
    return { synced: 0, skipped: true };
  }

  let synced = 0;
  for (const run of runRecords) {
    if (!run.runId) continue;

    const status = toLifecycleStatus(run);
    const timestamp =
      status === "done" || status === "failed" || status === "timeout" || status === "killed"
        ? toIso(run.endedAt)
        : toIso(run.startedAt || run.createdAt);

    const summary =
      status === "running"
        ? `OpenClaw sub-agent ${run.runId} is running`
        : status === "queued"
          ? `OpenClaw sub-agent ${run.runId} queued`
          : `OpenClaw sub-agent ${run.runId} ${status}${run.endedReason ? ` (${run.endedReason})` : ""}`;

    await ingestOpenClawLifecycleEvent({
      runId: run.runId,
      status,
      agentName: run.agent,
      role: run.role,
      jobType: run.label || "openclaw-subagent",
      summary,
      timestamp,
      metadata: {
        source: "openclaw-runs-store",
        label: run.label ?? null,
        assigned_to: run.assigned_to ?? null,
        agent: run.agent ?? null,
        role: run.role ?? null,
        task: run.task ?? null,
        childSessionKey: run.childSessionKey,
        requesterSessionKey: run.requesterSessionKey,
        outcome: run.outcome ?? null,
        endedReason: run.endedReason ?? null,
      },
    });
    synced += 1;
  }

  const backfill = await backfillOpenClawRunAssignments(200);

  lastMtimeMs = stats.mtimeMs;
  return { synced, backfill, skipped: false };
}
