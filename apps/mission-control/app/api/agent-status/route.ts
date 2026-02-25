import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AgentStatusRow = {
  name: string;
  role: string;
  last_active: Date | null;
};

const COVENANT_AGENTS = [
  { name: "Huragok", role: "research" },
  { name: "Monitor", role: "patterns" },
  { name: "Oracle", role: "prediction" },
  { name: "Librarian", role: "knowledge" },
] as const;

const toRelativeTime = (lastActive: Date | null) => {
  if (!lastActive) return "never";

  const diffMs = Date.now() - lastActive.getTime();
  if (diffMs <= 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const QUERY = `
  WITH agents(name, role) AS (
    VALUES
      ('Huragok', 'research'),
      ('Monitor', 'patterns'),
      ('Oracle', 'prediction'),
      ('Librarian', 'knowledge')
  )
  SELECT
    a.name,
    a.role,
    MAX(e.timestamp) AS last_active
  FROM agents a
  LEFT JOIN cortana_events e
    ON (
      COALESCE(e.source, '') ILIKE '%' || a.name || '%'
      OR COALESCE(e.event_type, '') ILIKE '%' || a.name || '%'
      OR COALESCE(e.message, '') ILIKE '%' || a.name || '%'
      OR COALESCE(e.metadata::text, '') ILIKE '%' || a.name || '%'
    )
  GROUP BY a.name, a.role
  ORDER BY a.name ASC
`;

export async function GET() {
  const taskPrisma = getTaskPrisma();
  const client = taskPrisma ?? prisma;

  const fetchRows = async (db: typeof prisma) =>
    db.$queryRawUnsafe<AgentStatusRow[]>(QUERY);

  let rows: AgentStatusRow[] = [];
  let source: "cortana" | "app" = taskPrisma ? "cortana" : "app";

  try {
    rows = await fetchRows(client);
  } catch (error) {
    if (!taskPrisma) throw error;
    source = "app";
    rows = await fetchRows(prisma);
  }

  const byName = new Map(rows.map((row) => [row.name, row]));
  const agents = COVENANT_AGENTS.map(({ name, role }) => {
    const row = byName.get(name);
    const lastActive = row?.last_active ?? null;

    return {
      name,
      role,
      lastActive: lastActive ? lastActive.toISOString() : null,
      relativeTime: toRelativeTime(lastActive),
    };
  });

  return NextResponse.json(
    { source, agents },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
