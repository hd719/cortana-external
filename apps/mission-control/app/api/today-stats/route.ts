import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCortanaPrisma } from "@/lib/cortana-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CountRow = { count: bigint | number };

const parseCount = (value: bigint | number | null | undefined) =>
  Number(typeof value === "bigint" ? value : value ?? 0);

export async function GET() {
  const cortanaPrisma = getCortanaPrisma();
  const cortanaClient = cortanaPrisma ?? prisma;

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

  const fetchCompletedRunCount = async () => {
    const count = await prisma.run.count({
      where: {
        OR: [{ status: "completed" }, { externalStatus: "completed" }],
        completedAt: {
          gte: start,
          lt: end,
        },
      },
    });
    return count;
  };

  const activeRunsNow = await prisma.run.count({
    where: {
      OR: [
        { status: { in: ["queued", "running"] } },
        { externalStatus: { in: ["queued", "running"] } },
      ],
    },
  });

  let source: "cortana" | "app" = cortanaPrisma ? "cortana" : "app";

  try {
    const [subagentsSpawnedToday, runsCompletedToday, selfHealsToday] =
      await Promise.all([
        fetchEventCount(cortanaClient, "event_type ILIKE 'subagent%'"),
        fetchCompletedRunCount(),
        fetchEventCount(cortanaClient, "event_type = 'auto_heal'"),
      ]);

    return NextResponse.json(
      {
        source,
        generatedAt: new Date().toISOString(),
        metrics: {
          subagentsSpawnedToday,
          runsCompletedToday,
          selfHealsToday,
          activeRunsNow,
        },
      },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    if (!cortanaPrisma) {
      throw error;
    }

    source = "app";

    const [subagentsSpawnedToday, runsCompletedToday, selfHealsToday] =
      await Promise.all([
        fetchEventCount(prisma, "event_type ILIKE 'subagent%'"),
        fetchCompletedRunCount(),
        fetchEventCount(prisma, "event_type = 'auto_heal'"),
      ]);

    return NextResponse.json(
      {
        source,
        generatedAt: new Date().toISOString(),
        metrics: {
          subagentsSpawnedToday,
          runsCompletedToday,
          selfHealsToday,
          activeRunsNow,
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
