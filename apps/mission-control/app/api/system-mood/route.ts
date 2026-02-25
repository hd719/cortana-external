import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

type MoodState = "nominal" | "heavy_load" | "completed" | "self_healing";

type CountRow = {
  count: bigint | number;
};

function toNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : 0;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const taskPrisma = getTaskPrisma() ?? prisma;

  const [activeSubagentsRows, selfHealRows, completionRows] = await Promise.all([
    taskPrisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM cortana_events
      WHERE event_type IN ('subagent.running', 'subagent.started')
        AND timestamp >= NOW() - INTERVAL '45 minutes'
    `,
    taskPrisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM cortana_events
      WHERE event_type = 'auto_heal'
        AND timestamp >= NOW() - INTERVAL '30 minutes'
    `,
    taskPrisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM cortana_tasks
      WHERE status IN ('done', 'completed')
        AND completed_at >= NOW() - INTERVAL '30 minutes'
    `,
  ]);

  const activeSubagents = toNumber(activeSubagentsRows[0]?.count);
  const recentSelfHeals = toNumber(selfHealRows[0]?.count);
  const recentCompletions = toNumber(completionRows[0]?.count);

  let mood: MoodState = "nominal";

  if (recentSelfHeals > 0) {
    mood = "self_healing";
  } else if (activeSubagents > 0) {
    mood = "heavy_load";
  } else if (recentCompletions > 0) {
    mood = "completed";
  }

  return NextResponse.json(
    {
      ok: true,
      mood,
      signals: {
        activeSubagents,
        recentSelfHeals,
        recentCompletions,
      },
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
