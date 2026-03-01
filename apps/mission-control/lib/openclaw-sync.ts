import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  backfillOpenClawRunAssignments,
  ingestOpenClawLifecycleEvent,
  OpenClawLifecycleStatus,
} from "@/lib/openclaw-bridge";
import prisma from "@/lib/prisma";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
  task?: JsonValue;
  agent?: string;
  role?: string;
  assigned_to?: string;
};

type OpenClawRunStore = {
  runs?: Record<string, OpenClawRunStoreRecord>;
};

type StaleRunCandidate = {
  id: string;
  openclawRunId: string | null;
  summary: string | null;
};

const DEFAULT_RUN_STORE_PATH = path.join(os.homedir(), ".openclaw", "subagents", "runs.json");
const RUN_STORE_PATH = process.env.OPENCLAW_SUBAGENT_RUNS_PATH || DEFAULT_RUN_STORE_PATH;

export const STALE_RUNNING_TTL_MS = 1000 * 60 * 10;

let lastSyncAt = 0;
let lastMtimeMs = 0;
let lastActiveRunIds = new Set<string>();

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

const reconcileStaleRunningRuns = async (activeRunIds: Set<string>) => {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_TTL_MS);

  const staleCandidates = (await prisma.run.findMany({
    where: {
      openclawRunId: { not: null },
      OR: [
        // Case 1: Never completed and still showing active
        {
          completedAt: null,
          externalStatus: { in: ["queued", "running"] },
          startedAt: { lte: staleBefore },
        },
        // Case 2: completedAt was set (e.g. manual fix) but external_status is still stale
        {
          completedAt: { not: null },
          externalStatus: { in: ["queued", "running"] },
        },
      ],
    },
    select: {
      id: true,
      openclawRunId: true,
      summary: true,
    },
  })) as StaleRunCandidate[];

  const staleRuns = staleCandidates.filter((run) => {
    const runId = run.openclawRunId;
    return !!runId && !activeRunIds.has(runId);
  });

  if (staleRuns.length === 0) {
    return 0;
  }

  await prisma.$transaction([
    ...staleRuns.map((run) =>
      prisma.run.update({
        where: { id: run.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          externalStatus: "done",
          summary:
            run.summary ??
            "Sub-agent run auto-completed after reconciliation TTL (run no longer active)",
          payload: {
            source: "openclaw-reconcile",
            reconciledAt: new Date().toISOString(),
            staleTtlMs: STALE_RUNNING_TTL_MS,
            uiStateGuard: true,
            reconciledTerminalState: "completed",
          },
        },
      })
    ),
    ...staleRuns.map((run) =>
      prisma.event.create({
        data: {
          runId: run.id,
          type: "subagent.reconciled_stale",
          severity: "warning",
          message: `Stale sub-agent state auto-reconciled for ${run.openclawRunId}`,
          metadata: {
            source: "openclaw-sync",
            openclawRunId: run.openclawRunId,
            action: "stale-ui-guard",
            ttlMs: STALE_RUNNING_TTL_MS,
          },
        },
      })
    ),
  ]);

  return staleRuns.length;
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
    const reconciled = await reconcileStaleRunningRuns(lastActiveRunIds);
    return { synced: 0, reconciled, skipped: true };
  }

  const raw = await fs.readFile(RUN_STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as OpenClawRunStore;
  const runRecords = Object.values(parsed.runs || {});

  if (runRecords.length === 0) {
    lastActiveRunIds = new Set<string>();
    const reconciled = await reconcileStaleRunningRuns(lastActiveRunIds);
    lastMtimeMs = stats.mtimeMs;
    return { synced: 0, reconciled, skipped: true };
  }

  const activeRunIds = new Set(
    runRecords.filter((run) => !run.endedAt && !!run.runId).map((run) => run.runId)
  );
  lastActiveRunIds = activeRunIds;

  const reconciled = await reconcileStaleRunningRuns(activeRunIds);

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
        childSessionKey: run.childSessionKey ?? null,
        requesterSessionKey: run.requesterSessionKey ?? null,
        outcome: run.outcome ? { status: run.outcome.status ?? null } : null,
        endedReason: run.endedReason ?? null,
      },
    });
    synced += 1;
  }

  const backfill = await backfillOpenClawRunAssignments(200);

  lastMtimeMs = stats.mtimeMs;
  return { synced, reconciled, backfill, skipped: false };
}
