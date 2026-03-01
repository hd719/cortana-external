import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

type HeartbeatStatus = "healthy" | "stale" | "missed" | "unknown";

type HeartbeatFile = {
  lastHeartbeat?: unknown;
};

type RunningSubagentRow = {
  session_id: string | null;
};

type TaskSummaryRow = {
  in_progress_count: bigint | number;
  completed_recent_count: bigint | number;
};

const HEARTBEAT_FILE = "/Users/hd/openclaw/memory/heartbeat-state.json";

function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

function heartbeatStatus(ageMs: number | null): HeartbeatStatus {
  if (ageMs == null) return "unknown";
  if (ageMs < 90 * 60 * 1000) return "healthy";
  if (ageMs <= 3 * 60 * 60 * 1000) return "stale";
  return "missed";
}

function toNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : 0;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const taskPrisma = getTaskPrisma() ?? prisma;

  const [heartbeat, runningSubagents, taskSummary] = await Promise.all([
    (async () => {
      try {
        const raw = await readFile(HEARTBEAT_FILE, "utf8");
        const parsed = JSON.parse(raw) as HeartbeatFile;
        const lastHeartbeat = normalizeTimestamp(parsed.lastHeartbeat);
        const ageMs =
          lastHeartbeat == null ? null : Math.max(0, Date.now() - lastHeartbeat);

        return {
          lastHeartbeat,
          ageMs,
          status: heartbeatStatus(ageMs),
        };
      } catch {
        return {
          lastHeartbeat: null,
          ageMs: null,
          status: "unknown" as HeartbeatStatus,
        };
      }
    })(),
    taskPrisma.$queryRaw<RunningSubagentRow[]>`
      SELECT DISTINCT
        COALESCE(
          metadata->>'sessionId',
          metadata->>'session_id',
          metadata->>'subagentSessionId',
          metadata->>'runId',
          message
        ) AS session_id
      FROM cortana_events
      WHERE event_type IN ('subagent.running', 'subagent.started')
        AND timestamp >= NOW() - INTERVAL '45 minutes'
      LIMIT 12
    `,
    taskPrisma.$queryRaw<TaskSummaryRow[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('in_progress', 'running')
            AND updated_at >= NOW() - INTERVAL '2 hours'
        ) AS in_progress_count,
        COUNT(*) FILTER (
          WHERE status IN ('done', 'completed')
            AND completed_at >= NOW() - INTERVAL '6 hours'
        ) AS completed_recent_count
      FROM cortana_tasks
    `,
  ]);

  const activeSubagents = runningSubagents.filter((row: RunningSubagentRow) => row.session_id).length;
  const summary = taskSummary[0] ?? {
    in_progress_count: 0,
    completed_recent_count: 0,
  };

  const inProgressTasks = toNumber(summary.in_progress_count);
  const completedRecently = toNumber(summary.completed_recent_count);

  const items: string[] = [];

  if (inProgressTasks > 0) {
    items.push(`Analyzing ${inProgressTasks} active task${inProgressTasks === 1 ? "" : "s"}...`);
  }

  if (completedRecently > 0) {
    items.push(
      `Reflecting on ${completedRecently} completed task${completedRecently === 1 ? "" : "s"}...`
    );
  }

  if (activeSubagents > 0) {
    items.push(
      `Monitoring ${activeSubagents} active sub-agent${activeSubagents === 1 ? "" : "s"}...`
    );
  }

  if (heartbeat.status === "stale") {
    items.push("Heartbeat drift detected — recalibrating cadence...");
  }

  if (heartbeat.status === "missed") {
    items.push("Heartbeat overdue — running recovery checks...");
  }

  if (items.length === 0) {
    items.push("Systems nominal.");
  }

  return NextResponse.json(
    {
      ok: true,
      idle: items.length === 1 && items[0] === "Systems nominal.",
      current: items[0],
      items,
      metrics: {
        activeSubagents,
        inProgressTasks,
        completedRecently,
      },
      heartbeat,
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
