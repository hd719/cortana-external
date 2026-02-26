import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JobSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  | { kind: "at"; at: string }
  | { kind: string; [key: string]: unknown };

type JobDefinition = {
  name: string;
  enabled?: boolean;
  schedule?: JobSchedule;
  state?: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    consecutiveErrors?: number;
    lastDurationMs?: number;
  };
};

type JobsFile = {
  jobs?: JobDefinition[];
};

type HealthRow = {
  cron_name: string;
  timestamp: Date | string | null;
  status: string | null;
  consecutive_failures: number | null;
  run_duration_sec: number | null;
  last_error: string | null;
};

type CronHealthStatus = "healthy" | "late" | "failed";

const JOBS_PATH = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");

const CRON_LATE_MULTIPLIER = 2;

const parseCronIntervalMs = (expr?: string | null) => {
  if (!expr) return null;

  const [minute = "*", hour = "*", dayOfMonth = "*", _month = "*", dayOfWeek = "*"] =
    expr.trim().split(/\s+/);

  const stepValue = (field: string) => {
    const match = field.match(/^\*\/(\d+)$/);
    return match ? Number(match[1]) : null;
  };

  const minuteStep = stepValue(minute);
  if (minuteStep && minuteStep > 0) return minuteStep * 60_000;

  const hourStep = stepValue(hour);
  if (hourStep && hourStep > 0) return hourStep * 3_600_000;

  const dayStep = stepValue(dayOfMonth);
  if (dayStep && dayStep > 0) return dayStep * 86_400_000;

  if (minute === "*" && hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return 60_000;
  }

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*" && minute !== "*") {
    return 3_600_000;
  }

  if (dayOfWeek !== "*" && dayOfMonth === "*") {
    return 7 * 86_400_000;
  }

  if (dayOfMonth !== "*" || dayOfWeek !== "*") {
    return 86_400_000;
  }

  return 86_400_000;
};

const getExpectedIntervalMs = (schedule?: JobSchedule) => {
  if (!schedule) return null;
  if (schedule.kind === "every" && typeof (schedule as { everyMs?: unknown }).everyMs === "number") {
    return (schedule as { everyMs: number }).everyMs;
  }
  if (schedule.kind === "cron") {
    return parseCronIntervalMs((schedule as { expr?: string | null }).expr);
  }
  return null;
};

const normalizeStatus = (
  status: string | null | undefined,
  consecutiveFailures: number,
  isLate: boolean
): CronHealthStatus => {
  const value = (status || "").toLowerCase();
  const explicitlyFailed =
    value === "failed" || value === "error" || value === "timeout" || value === "stale";

  if (explicitlyFailed || consecutiveFailures > 0) {
    return "failed";
  }

  if (isLate) {
    return "late";
  }

  return "healthy";
};

const toScheduleText = (schedule?: JobSchedule) => {
  if (!schedule) return "—";
  if (schedule.kind === "cron") return (schedule as { expr?: string }).expr || "—";
  if (schedule.kind === "every") {
    const ms = Number((schedule as { everyMs?: number }).everyMs || 0);
    if (!ms) return "every";
    const minutes = Math.round(ms / 60_000);
    return `every ${minutes}m`;
  }
  if (schedule.kind === "at") return `at ${schedule.at}`;
  return schedule.kind;
};

export async function GET() {
  const raw = await fs.readFile(JOBS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as JobsFile;
  const jobs = (parsed.jobs || []).filter((job) => job.enabled !== false);

  const taskPrisma = getTaskPrisma();
  const client = taskPrisma ?? prisma;

  const query = `
    SELECT DISTINCT ON (cron_name)
      cron_name,
      timestamp,
      status,
      consecutive_failures,
      run_duration_sec,
      COALESCE(metadata->>'last_error', metadata->>'error', metadata->>'message') AS last_error
    FROM cortana_cron_health
    ORDER BY cron_name, timestamp DESC
  `;

  let rows: HealthRow[] = [];
  let source: "cortana" | "app" = taskPrisma ? "cortana" : "app";

  try {
    rows = await client.$queryRawUnsafe<HealthRow[]>(query);
  } catch (error) {
    if (!taskPrisma) throw error;
    source = "app";
    rows = await prisma.$queryRawUnsafe<HealthRow[]>(query);
  }

  const byName = new Map(rows.map((row) => [row.cron_name, row]));
  const now = Date.now();

  const crons = jobs.map((job) => {
    const row = byName.get(job.name);
    const dbLastFire = row?.timestamp ? new Date(row.timestamp).getTime() : null;
    const stateLastFire = job.state?.lastRunAtMs ?? null;
    const lastFireMs = dbLastFire ?? stateLastFire;

    const expectedIntervalMs = getExpectedIntervalMs(job.schedule);
    const isLate =
      Boolean(lastFireMs && expectedIntervalMs) &&
      now - Number(lastFireMs) > Number(expectedIntervalMs) * CRON_LATE_MULTIPLIER;

    const consecutiveFailures = Number(
      row?.consecutive_failures ?? job.state?.consecutiveErrors ?? 0
    );

    const status = normalizeStatus(row?.status ?? job.state?.lastStatus, consecutiveFailures, isLate);

    const lastDurationSec =
      row?.run_duration_sec ??
      (typeof job.state?.lastDurationMs === "number" ? Number(job.state.lastDurationMs) / 1000 : null);

    return {
      name: job.name,
      schedule: toScheduleText(job.schedule),
      last_fire_time: lastFireMs ? new Date(lastFireMs).toISOString() : null,
      status,
      consecutive_failures: consecutiveFailures,
      last_duration_sec: typeof lastDurationSec === "number" ? Number(lastDurationSec) : null,
      last_error: row?.last_error ?? job.state?.lastError ?? null,
    };
  });

  return NextResponse.json(
    {
      source,
      generatedAt: new Date().toISOString(),
      crons,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
