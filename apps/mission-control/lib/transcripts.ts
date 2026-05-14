import prisma from "@/lib/prisma";
import { getCortanaPrisma } from "@/lib/cortana-prisma";

export type TranscriptFilters = {
  rangeHours?: number;
  limit?: number;
  sessionId?: string;
  speakerId?: string;
  messageType?: string;
  query?: string;
};

export type TranscriptMessage = {
  id: number;
  sessionId: string;
  turnNo: number;
  speakerId: string;
  messageType: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  sessionTopic: string;
  sessionMode: string;
  sessionStatus: string;
  sessionCreatedAt: string;
};

type TranscriptRow = {
  id: number | bigint;
  session_id: string;
  turn_no: number | bigint;
  speaker_id: string;
  message_type: string;
  content: string;
  metadata: unknown;
  created_at: Date;
  session_topic: string;
  session_mode: string;
  session_status: string;
  session_created_at: Date;
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");

const normalizeObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const normalizeFilter = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
};

export async function getTranscriptMessages(filters: TranscriptFilters = {}): Promise<{
  messages: TranscriptMessage[];
  facets: {
    speakers: string[];
    messageTypes: string[];
    sessions: Array<{ id: string; topic: string }>;
  };
  source: "cortana" | "app";
  warning?: string;
}> {
  const cortanaPrisma = getCortanaPrisma();
  const preferred = cortanaPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 120, 500));
  const rangeHours = Math.max(1, Math.min(filters.rangeHours ?? 24, 24 * 30));

  const conditions: string[] = [
    `m.created_at >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  const sessionId = normalizeFilter(filters.sessionId);
  if (sessionId) {
    conditions.push(`m.session_id = '${escapeLiteral(sessionId)}'`);
  }

  const speakerId = normalizeFilter(filters.speakerId);
  if (speakerId) {
    conditions.push(`m.speaker_id = '${escapeLiteral(speakerId)}'`);
  }

  const messageType = normalizeFilter(filters.messageType);
  if (messageType) {
    conditions.push(`m.message_type = '${escapeLiteral(messageType)}'`);
  }

  const query = normalizeFilter(filters.query);
  if (query) {
    const safeQuery = escapeLiteral(query);
    conditions.push(
      `(m.content ILIKE '%${safeQuery}%' OR m.speaker_id ILIKE '%${safeQuery}%' OR s.topic ILIKE '%${safeQuery}%')`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      m.id,
      m.session_id,
      m.turn_no,
      m.speaker_id,
      m.message_type,
      m.content,
      m.metadata,
      m.created_at,
      s.topic AS session_topic,
      s.mode AS session_mode,
      s.status AS session_status,
      s.created_at AS session_created_at
    FROM mc_council_messages m
    JOIN mc_council_sessions s ON s.id = m.session_id
    ${whereClause}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) =>
    client.$queryRawUnsafe<TranscriptRow[]>(sql);

  let rows: TranscriptRow[] = [];
  let sourceLabel: "cortana" | "app" = cortanaPrisma ? "cortana" : "app";
  let warning: string | undefined;

  try {
    rows = await runQuery(preferred);
  } catch (error) {
    if (!cortanaPrisma) throw error;
    sourceLabel = "app";
    warning = "Transcript stream unavailable in cortana DB; fell back to app DB.";
    rows = await runQuery(prisma);
  }

  const messages: TranscriptMessage[] = rows.map((row) => ({
    id: Number(row.id),
    sessionId: row.session_id,
    turnNo: Number(row.turn_no),
    speakerId: row.speaker_id,
    messageType: row.message_type,
    content: row.content,
    metadata: normalizeObject(row.metadata),
    createdAt: row.created_at.toISOString(),
    sessionTopic: row.session_topic,
    sessionMode: row.session_mode,
    sessionStatus: row.session_status,
    sessionCreatedAt: row.session_created_at.toISOString(),
  }));

  const facets = {
    speakers: Array.from(new Set(messages.map((message) => message.speakerId))).sort(),
    messageTypes: Array.from(new Set(messages.map((message) => message.messageType))).sort(),
    sessions: Array.from(
      new Map(messages.map((message) => [message.sessionId, message.sessionTopic])).entries()
    ).map(([id, topic]) => ({ id, topic })),
  };

  return {
    messages,
    facets,
    source: sourceLabel,
    warning,
  };
}
