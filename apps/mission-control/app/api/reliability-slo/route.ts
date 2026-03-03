import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import prisma from "@/lib/prisma";
import { computeReliabilitySloMetrics } from "@/lib/reliability-slo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JOBS_PATH = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");
const WINDOW_MS = 24 * 60 * 60 * 1000;

type JobsFile = {
  jobs?: Array<{
    enabled?: boolean;
    schedule?: { kind: string; [key: string]: unknown };
    delivery?: { mode?: string; to?: string };
    state?: {
      nextRunAtMs?: number;
      consecutiveErrors?: number;
      lastStatus?: string;
      lastDelivered?: boolean;
      lastDeliveryStatus?: string;
    };
  }>;
};

export async function GET() {
  const raw = await fs.readFile(JOBS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as JobsFile;
  const jobs = parsed.jobs || [];

  const since = new Date(Date.now() - WINDOW_MS);
  const runs = await prisma.run.findMany({
    where: {
      OR: [{ startedAt: { gte: since } }, { createdAt: { gte: since } }],
    },
    select: {
      status: true,
      externalStatus: true,
      startedAt: true,
      completedAt: true,
      payload: true,
      summary: true,
    },
    take: 2000,
    orderBy: { createdAt: "desc" },
  });

  const metrics = computeReliabilitySloMetrics({ jobs, runs, nowMs: Date.now() });

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      metrics,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
