import prisma from "@/lib/prisma";
import { getCortanaPrisma } from "@/lib/cortana-prisma";

export type LogFilters = {
  rangeHours?: number;
  limit?: number;
  severity?: string;
  source?: string;
  eventType?: string;
  query?: string;
};

export type LogEntry = {
  id: number;
  timestamp: string;
  eventType: string;
  source: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
};

type LogRow = {
  id: number | bigint;
  timestamp: Date;
  event_type: string;
  source: string;
  severity: string | null;
  message: string;
  metadata: unknown;
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");

const normalizeObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const normalizeFilter = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
};

export async function getLogEntries(filters: LogFilters = {}): Promise<{
  logs: LogEntry[];
  facets: {
    severities: string[];
    sources: string[];
    eventTypes: string[];
  };
  source: "cortana" | "app";
  warning?: string;
}> {
  const cortanaPrisma = getCortanaPrisma();
  const preferred = cortanaPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 120, 500));
  const rangeHours = Math.max(1, Math.min(filters.rangeHours ?? 24, 24 * 30));

  const conditions: string[] = [
    `timestamp >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  const severity = normalizeFilter(filters.severity);
  if (severity) {
    if (severity.toLowerCase() === "alerts") {
      conditions.push(`lower(coalesce(severity, '')) IN ('warning', 'critical')`);
    } else {
      conditions.push(`lower(severity) = '${escapeLiteral(severity.toLowerCase())}'`);
    }
  }

  const source = normalizeFilter(filters.source);
  if (source) {
    conditions.push(`source = '${escapeLiteral(source)}'`);
  }

  const eventType = normalizeFilter(filters.eventType);
  if (eventType) {
    conditions.push(`event_type = '${escapeLiteral(eventType)}'`);
  }

  const query = normalizeFilter(filters.query);
  if (query) {
    const safeQuery = escapeLiteral(query);
    conditions.push(
      `(message ILIKE '%${safeQuery}%' OR event_type ILIKE '%${safeQuery}%' OR source ILIKE '%${safeQuery}%')`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT id, timestamp, event_type, source, severity, message, metadata
    FROM cortana_events
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) =>
    client.$queryRawUnsafe<LogRow[]>(sql);

  let rows: LogRow[] = [];
  let sourceLabel: "cortana" | "app" = cortanaPrisma ? "cortana" : "app";
  let warning: string | undefined;

  try {
    rows = await runQuery(preferred);
  } catch (error) {
    if (!cortanaPrisma) throw error;
    sourceLabel = "app";
    warning = "Log stream unavailable in cortana DB; fell back to app DB.";
    rows = await runQuery(prisma);
  }

  const logs: LogEntry[] = rows.map((row) => ({
    id: Number(row.id),
    timestamp: row.timestamp.toISOString(),
    eventType: row.event_type,
    source: row.source,
    severity: row.severity ?? "info",
    message: row.message,
    metadata: normalizeObject(row.metadata),
  }));

  const facets = {
    severities: Array.from(new Set(logs.map((log) => log.severity))).sort(),
    sources: Array.from(new Set(logs.map((log) => log.source))).sort(),
    eventTypes: Array.from(new Set(logs.map((log) => log.eventType))).sort(),
  };

  return {
    logs,
    facets,
    source: sourceLabel,
    warning,
  };
}
