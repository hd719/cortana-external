import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export type RemediationStatus = "open" | "in_progress" | "resolved" | "wont_fix";

export const REMEDIATION_STATUSES: RemediationStatus[] = ["open", "in_progress", "resolved", "wont_fix"];

export type FeedbackFilters = {
  status?: "new" | "triaged" | "in_progress" | "verified" | "wont_fix" | "all";
  remediationStatus?: RemediationStatus | "all";
  severity?: "low" | "medium" | "high" | "critical" | "all";
  category?: string;
  source?: "user" | "system" | "evaluator" | "all";
  rangeHours?: number;
  limit?: number;
};

export type FeedbackAction = {
  id: number;
  feedbackId: string;
  actionType: string;
  actionRef: string | null;
  description: string | null;
  status: "planned" | "applied" | "verified" | "failed";
  createdAt: string;
  verifiedAt: string | null;
};

export type FeedbackItem = {
  id: string;
  runId: string | null;
  taskId: string | null;
  linkedTaskId: number | null;
  linkedTaskStatus: string | null;
  agentId: string | null;
  source: "user" | "system" | "evaluator";
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  details: Record<string, unknown>;
  recurrenceKey: string | null;
  status: "new" | "triaged" | "in_progress" | "verified" | "wont_fix";
  owner: string | null;
  createdAt: string;
  updatedAt: string;
  actionCount: number;
  remediationStatus: RemediationStatus;
  remediationNotes: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  actions?: FeedbackAction[];
};

export type FeedbackMetrics = {
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  byRemediationStatus: Record<string, number>;
  byCategory: Record<string, number>;
  dailyCorrections: Array<{ day: string; count: number }>;
};

type FeedbackRow = {
  id: string;
  run_id: string | null;
  task_id: string | null;
  linked_task_id: number | null;
  linked_task_status: string | null;
  agent_id: string | null;
  source: "user" | "system" | "evaluator";
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  details: unknown;
  recurrence_key: string | null;
  status: "new" | "triaged" | "in_progress" | "verified" | "wont_fix";
  owner: string | null;
  created_at: Date;
  updated_at: Date;
  action_count: number;
  remediation_status: RemediationStatus;
  remediation_notes: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
};

type FeedbackActionRow = {
  id: number;
  feedback_id: string;
  action_type: string;
  action_ref: string | null;
  description: string | null;
  status: "planned" | "applied" | "verified" | "failed";
  created_at: Date;
  verified_at: Date | null;
};

const normalizeObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");

const mapItem = (row: FeedbackRow): FeedbackItem => ({
  id: row.id,
  runId: row.run_id,
  taskId: row.task_id,
  linkedTaskId: row.linked_task_id != null ? Number(row.linked_task_id) : null,
  linkedTaskStatus: row.linked_task_status ?? null,
  agentId: row.agent_id,
  source: row.source,
  category: row.category,
  severity: row.severity,
  summary: row.summary,
  details: normalizeObject(row.details),
  recurrenceKey: row.recurrence_key,
  status: row.status,
  owner: row.owner,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  actionCount: Number(row.action_count || 0),
  remediationStatus: row.remediation_status,
  remediationNotes: row.remediation_notes,
  resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  resolvedBy: row.resolved_by,
});

const mapAction = (row: FeedbackActionRow): FeedbackAction => ({
  id: row.id,
  feedbackId: row.feedback_id,
  actionType: row.action_type,
  actionRef: row.action_ref,
  description: row.description,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
});

export async function getFeedbackItems(filters: FeedbackFilters = {}): Promise<FeedbackItem[]> {
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const rangeHours = Math.max(1, Math.min(filters.rangeHours ?? 24 * 14, 24 * 90));

  const conditions: string[] = [
    `f.created_at >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  if (filters.status && filters.status !== "all") {
    conditions.push(`f.status = '${escapeLiteral(filters.status)}'`);
  }
  if (filters.severity && filters.severity !== "all") {
    conditions.push(`f.severity = '${escapeLiteral(filters.severity)}'`);
  }
  if (filters.remediationStatus && filters.remediationStatus !== "all") {
    conditions.push(`f.remediation_status = '${escapeLiteral(filters.remediationStatus)}'`);
  }
  if (filters.category && filters.category !== "all") {
    conditions.push(`f.category = '${escapeLiteral(filters.category)}'`);
  }
  if (filters.source && filters.source !== "all") {
    conditions.push(`f.source = '${escapeLiteral(filters.source)}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      f.id,
      f.run_id,
      f.task_id,
      MAX(COALESCE(task_meta.id, task_fallback.id))::int AS linked_task_id,
      MAX(COALESCE(task_meta.status, task_fallback.status))::text AS linked_task_status,
      f.agent_id,
      f.source,
      f.category,
      f.severity,
      f.summary,
      f.details,
      f.recurrence_key,
      f.status,
      f.owner,
      f.created_at,
      f.updated_at,
      f.remediation_status,
      f.remediation_notes,
      f.resolved_at,
      f.resolved_by,
      COUNT(a.id)::int AS action_count
    FROM mc_feedback_items f
    LEFT JOIN mc_feedback_actions a ON a.feedback_id = f.id
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM cortana_tasks t
      WHERE t.metadata->>'feedback_id' = f.id::text
      ORDER BY t.updated_at DESC
      LIMIT 1
    ) task_meta ON true
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM cortana_tasks t
      WHERE t.id::text = f.task_id::text
      ORDER BY t.updated_at DESC
      LIMIT 1
    ) task_fallback ON task_meta.id IS NULL
    ${whereClause}
    GROUP BY f.id
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) => client.$queryRawUnsafe<FeedbackRow[]>(query);

  try {
    const rows = await runQuery(preferred);
    return rows.map(mapItem);
  } catch (error) {
    if (!taskPrisma) throw error;
    const rows = await runQuery(prisma);
    return rows.map(mapItem);
  }
}

export async function getFeedbackById(id: string): Promise<FeedbackItem | null> {
  const safeId = escapeLiteral(id);
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const itemQuery = `
    SELECT
      f.id,
      f.run_id,
      f.task_id,
      MAX(COALESCE(task_meta.id, task_fallback.id))::int AS linked_task_id,
      MAX(COALESCE(task_meta.status, task_fallback.status))::text AS linked_task_status,
      f.agent_id,
      f.source,
      f.category,
      f.severity,
      f.summary,
      f.details,
      f.recurrence_key,
      f.status,
      f.owner,
      f.created_at,
      f.updated_at,
      f.remediation_status,
      f.remediation_notes,
      f.resolved_at,
      f.resolved_by,
      COUNT(a.id)::int AS action_count
    FROM mc_feedback_items f
    LEFT JOIN mc_feedback_actions a ON a.feedback_id = f.id
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM cortana_tasks t
      WHERE t.metadata->>'feedback_id' = f.id::text
      ORDER BY t.updated_at DESC
      LIMIT 1
    ) task_meta ON true
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM cortana_tasks t
      WHERE t.id::text = f.task_id::text
      ORDER BY t.updated_at DESC
      LIMIT 1
    ) task_fallback ON task_meta.id IS NULL
    WHERE f.id = '${safeId}'
    GROUP BY f.id
    LIMIT 1
  `;

  const actionsQuery = `
    SELECT id, feedback_id, action_type, action_ref, description, status, created_at, verified_at
    FROM mc_feedback_actions
    WHERE feedback_id = '${safeId}'
    ORDER BY created_at ASC
  `;

  const run = async (client: typeof prisma) => {
    const [itemRows, actionRows] = await Promise.all([
      client.$queryRawUnsafe<FeedbackRow[]>(itemQuery),
      client.$queryRawUnsafe<FeedbackActionRow[]>(actionsQuery),
    ]);
    return { itemRows, actionRows };
  };

  try {
    const { itemRows, actionRows } = await run(preferred);
    if (itemRows.length === 0) return null;
    return { ...mapItem(itemRows[0]), actions: actionRows.map(mapAction) };
  } catch (error) {
    if (!taskPrisma) throw error;
    const { itemRows, actionRows } = await run(prisma);
    if (itemRows.length === 0) return null;
    return { ...mapItem(itemRows[0]), actions: actionRows.map(mapAction) };
  }
}

export async function createFeedback(data: {
  runId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  source: "user" | "system" | "evaluator";
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  details?: Record<string, unknown>;
  recurrenceKey?: string | null;
  status?: "new" | "triaged" | "in_progress" | "verified" | "wont_fix";
  owner?: string | null;
}): Promise<string> {
  const runId = data.runId ? `'${escapeLiteral(data.runId)}'` : "NULL";
  const taskId = data.taskId ? `'${escapeLiteral(data.taskId)}'` : "NULL";
  const agentId = data.agentId ? `'${escapeLiteral(data.agentId)}'` : "NULL";
  const details = data.details ? `'${JSON.stringify(data.details).replaceAll("'", "''")}'::jsonb` : "NULL";
  const recurrenceKey = data.recurrenceKey ? `'${escapeLiteral(data.recurrenceKey)}'` : "NULL";
  const owner = data.owner ? `'${escapeLiteral(data.owner)}'` : "NULL";
  const status = data.status ?? "new";

  const sql = `
    INSERT INTO mc_feedback_items (
      run_id,
      task_id,
      agent_id,
      source,
      category,
      severity,
      summary,
      details,
      recurrence_key,
      status,
      owner
    ) VALUES (
      ${runId},
      ${taskId},
      ${agentId},
      '${escapeLiteral(data.source)}',
      '${escapeLiteral(data.category)}',
      '${escapeLiteral(data.severity)}',
      '${escapeLiteral(data.summary)}',
      ${details},
      ${recurrenceKey},
      '${escapeLiteral(status)}',
      ${owner}
    ) RETURNING id
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => client.$queryRawUnsafe<Array<{ id: string }>>(sql);

  try {
    const rows = await run(preferred);
    return rows[0]?.id ?? "";
  } catch (error) {
    if (!taskPrisma) throw error;
    const rows = await run(prisma);
    return rows[0]?.id ?? "";
  }
}

export async function updateFeedbackStatus(
  id: string,
  status: "new" | "triaged" | "in_progress" | "verified" | "wont_fix",
  owner?: string,
): Promise<void> {
  const safeId = escapeLiteral(id);
  const safeOwner = owner ? `'${escapeLiteral(owner)}'` : "owner";

  const sql = `
    UPDATE mc_feedback_items
    SET
      status = '${escapeLiteral(status)}',
      owner = ${safeOwner},
      updated_at = NOW()
    WHERE id = '${safeId}'
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}


export async function updateFeedbackRemediation(
  id: string,
  remediationStatus: RemediationStatus,
  remediationNotes?: string | null,
  resolvedBy?: string | null,
): Promise<boolean> {
  const safeId = escapeLiteral(id);
  const safeNotes = remediationNotes ? `'${escapeLiteral(remediationNotes)}'` : "NULL";
  const safeResolvedBy = resolvedBy ? `'${escapeLiteral(resolvedBy)}'` : "NULL";
  const shouldResolve = remediationStatus === "resolved";
  const resolvedAtSql = shouldResolve ? "NOW()" : "NULL";

  const sql = `
    UPDATE mc_feedback_items
    SET
      remediation_status = '${escapeLiteral(remediationStatus)}',
      remediation_notes = ${safeNotes},
      resolved_at = ${resolvedAtSql},
      resolved_by = ${safeResolvedBy},
      updated_at = NOW()
    WHERE id = '${safeId}'
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => client.$executeRawUnsafe(sql);

  try {
    const result = await run(preferred);
    return result > 0;
  } catch (error) {
    if (!taskPrisma) throw error;
    const result = await run(prisma);
    return result > 0;
  }
}

export async function addFeedbackAction(
  feedbackId: string,
  data: {
    actionType: string;
    actionRef?: string | null;
    description?: string | null;
    status: "planned" | "applied" | "verified" | "failed";
    verifiedAt?: string | null;
  },
): Promise<void> {
  const safeFeedbackId = escapeLiteral(feedbackId);
  const actionRef = data.actionRef ? `'${escapeLiteral(data.actionRef)}'` : "NULL";
  const description = data.description ? `'${escapeLiteral(data.description)}'` : "NULL";
  const verifiedAt = data.verifiedAt ? `'${escapeLiteral(data.verifiedAt)}'::timestamptz` : "NULL";

  const sql = `
    INSERT INTO mc_feedback_actions (
      feedback_id,
      action_type,
      action_ref,
      description,
      status,
      verified_at
    ) VALUES (
      '${safeFeedbackId}',
      '${escapeLiteral(data.actionType)}',
      ${actionRef},
      ${description},
      '${escapeLiteral(data.status)}',
      ${verifiedAt}
    )
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}

export async function getFeedbackMetrics(): Promise<FeedbackMetrics> {
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const bySeveritySql = `
    SELECT severity, COUNT(*)::int AS count
    FROM mc_feedback_items
    GROUP BY severity
  `;

  const byStatusSql = `
    SELECT status, COUNT(*)::int AS count
    FROM mc_feedback_items
    GROUP BY status
  `;

  const byRemediationStatusSql = `
    SELECT remediation_status AS status, COUNT(*)::int AS count
    FROM mc_feedback_items
    GROUP BY remediation_status
  `;

  const byCategorySql = `
    SELECT category, COUNT(*)::int AS count
    FROM mc_feedback_items
    GROUP BY category
    ORDER BY count DESC
  `;

  const dailySql = `
    SELECT to_char(day, 'YYYY-MM-DD') AS day, count::int
    FROM (
      SELECT
        date_trunc('day', created_at) AS day,
        COUNT(*) AS count
      FROM mc_feedback_items
      WHERE created_at >= NOW() - INTERVAL '14 days'
      GROUP BY date_trunc('day', created_at)
    ) t
    ORDER BY day ASC
  `;

  const run = async (client: typeof prisma) => {
    const [severityRows, statusRows, remediationRows, categoryRows, dailyRows] = await Promise.all([
      client.$queryRawUnsafe<Array<{ severity: string; count: number }>>(bySeveritySql),
      client.$queryRawUnsafe<Array<{ status: string; count: number }>>(byStatusSql),
      client.$queryRawUnsafe<Array<{ status: string; count: number }>>(byRemediationStatusSql),
      client.$queryRawUnsafe<Array<{ category: string; count: number }>>(byCategorySql),
      client.$queryRawUnsafe<Array<{ day: string; count: number }>>(dailySql),
    ]);

    return { severityRows, statusRows, remediationRows, categoryRows, dailyRows };
  };

  const toRecord = (rows: Array<{ [key: string]: string | number }>, keyName: string) => {
    const record: Record<string, number> = {};
    rows.forEach((row) => {
      const key = String(row[keyName]);
      const count = Number(row.count || 0);
      record[key] = count;
    });
    return record;
  };

  try {
    const { severityRows, statusRows, remediationRows, categoryRows, dailyRows } = await run(preferred);
    return {
      bySeverity: toRecord(severityRows as Array<{ [key: string]: string | number }>, "severity"),
      byStatus: toRecord(statusRows as Array<{ [key: string]: string | number }>, "status"),
      byRemediationStatus: toRecord(remediationRows as Array<{ [key: string]: string | number }>, "status"),
      byCategory: toRecord(categoryRows as Array<{ [key: string]: string | number }>, "category"),
      dailyCorrections: dailyRows.map((row) => ({ day: row.day, count: Number(row.count || 0) })),
    };
  } catch (error) {
    if (!taskPrisma) throw error;
    const { severityRows, statusRows, remediationRows, categoryRows, dailyRows } = await run(prisma);
    return {
      bySeverity: toRecord(severityRows as Array<{ [key: string]: string | number }>, "severity"),
      byStatus: toRecord(statusRows as Array<{ [key: string]: string | number }>, "status"),
      byRemediationStatus: toRecord(remediationRows as Array<{ [key: string]: string | number }>, "status"),
      byCategory: toRecord(categoryRows as Array<{ [key: string]: string | number }>, "category"),
      dailyCorrections: dailyRows.map((row) => ({ day: row.day, count: Number(row.count || 0) })),
    };
  }
}

// Safety: Prisma raw queries sometimes return BigInt for aggregates
// @ts-expect-error BigInt serialization
BigInt.prototype.toJSON = function () { return Number(this); };
