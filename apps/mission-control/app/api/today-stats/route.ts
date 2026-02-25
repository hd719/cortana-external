import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CountRow = { count: bigint | number };

const parseCount = (value: bigint | number | null | undefined) =>
  Number(typeof value === "bigint" ? value : value ?? 0);

const isMissingRelationError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("does not exist") || message.includes("undefined table");
};

export async function GET() {
  const taskPrisma = getTaskPrisma();
  const taskClient = taskPrisma ?? prisma;

  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const fetchEventCount = async (db: typeof prisma, clause: string) => {
    const rows = await db.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM cortana_events
       WHERE timestamp >= $1 AND timestamp < $2
         AND ${clause}`,
      start,
      end
    );
    return parseCount(rows[0]?.count);
  };

  const fetchTaskCount = async (db: typeof prisma) => {
    const rows = await db.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM cortana_tasks
       WHERE completed_at >= $1 AND completed_at < $2`,
      start,
      end
    );
    return parseCount(rows[0]?.count);
  };

  const fetchDecisionCount = async (db: typeof prisma) => {
    try {
      const rows = await db.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::bigint AS count
         FROM cortana_decision_traces
         WHERE timestamp >= $1 AND timestamp < $2`,
        start,
        end
      );
      return parseCount(rows[0]?.count);
    } catch (error) {
      if (isMissingRelationError(error)) {
        return 0;
      }
      throw error;
    }
  };

  const activeRunsNow = await prisma.run.count({
    where: {
      OR: [
        { status: { in: ["queued", "running"] } },
        { externalStatus: { in: ["queued", "running"] } },
      ],
    },
  });

  let source: "cortana" | "app" = taskPrisma ? "cortana" : "app";

  try {
    const [subagentsSpawnedToday, tasksCompletedToday, selfHealsToday, decisionsLoggedToday] =
      await Promise.all([
        fetchEventCount(taskClient, "event_type ILIKE 'subagent%'"),
        fetchTaskCount(taskClient),
        fetchEventCount(taskClient, "event_type = 'auto_heal'"),
        fetchDecisionCount(taskClient),
      ]);

    return NextResponse.json(
      {
        source,
        generatedAt: new Date().toISOString(),
        metrics: {
          subagentsSpawnedToday,
          tasksCompletedToday,
          selfHealsToday,
          activeRunsNow,
          decisionsLoggedToday,
        },
      },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    if (!taskPrisma) {
      throw error;
    }

    source = "app";

    const [subagentsSpawnedToday, tasksCompletedToday, selfHealsToday, decisionsLoggedToday] =
      await Promise.all([
        fetchEventCount(prisma, "event_type ILIKE 'subagent%'"),
        fetchTaskCount(prisma),
        fetchEventCount(prisma, "event_type = 'auto_heal'"),
        fetchDecisionCount(prisma),
      ]);

    return NextResponse.json(
      {
        source,
        generatedAt: new Date().toISOString(),
        metrics: {
          subagentsSpawnedToday,
          tasksCompletedToday,
          selfHealsToday,
          activeRunsNow,
          decisionsLoggedToday,
        },
      },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  }
}
