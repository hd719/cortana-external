import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActivityFeedRow = {
  id: number;
  timestamp: Date;
  event_type: string;
  source: string;
  severity: string;
  message: string;
};

const normalizeSeverity = (severity?: string | null, eventType?: string) => {
  const level = (severity || "").toLowerCase();
  if (["critical", "error", "failed"].includes(level)) return "error";
  if (["warning", "warn"].includes(level)) return "warning";
  if (["success", "ok", "done", "completed"].includes(level)) return "success";

  const type = (eventType || "").toLowerCase();
  if (["complete", "success", "merged", "done"].some((k: any) => type.includes(k))) return "success";
  if (["fail", "error", "timeout", "crash"].some((k: any) => type.includes(k))) return "error";
  if (["warn", "retry", "fallback"].some((k: any) => type.includes(k))) return "warning";
  return "info";
};

export async function GET() {
  const taskPrisma = getTaskPrisma();
  const client = taskPrisma ?? prisma;

  const fetchRows = async (db: typeof prisma) =>
    db.$queryRawUnsafe<ActivityFeedRow[]>(`
      SELECT id, timestamp, event_type, source, severity, message
      FROM cortana_events
      ORDER BY timestamp DESC, id DESC
      LIMIT 30
    `);

  let rows: ActivityFeedRow[] = [];
  let source: "cortana" | "app" = taskPrisma ? "cortana" : "app";

  try {
    rows = await fetchRows(client);
  } catch (error) {
    if (!taskPrisma) throw error;
    source = "app";
    rows = await fetchRows(prisma);
  }

  const events = rows.map((row: any) => ({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    eventType: row.event_type,
    source: row.source,
    severity: normalizeSeverity(row.severity, row.event_type),
    message: row.message,
  }));

  return NextResponse.json(
    {
      source,
      events,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
