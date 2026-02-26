import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export type ApprovalFilters = {
  status?: "pending" | "approved" | "approved_edited" | "rejected" | "expired" | "cancelled" | "all";
  risk_level?: "p0" | "p1" | "p2" | "p3";
  rangeHours?: number;
  limit?: number;
};

export type ApprovalEvent = {
  id: number;
  approvalId: string;
  eventType: string;
  actor: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  runId: string | null;
  taskId: string | null;
  agentId: string;
  actionType: string;
  proposal: Record<string, unknown>;
  diff: Record<string, unknown> | null;
  rationale: string | null;
  riskLevel: "p0" | "p1" | "p2" | "p3";
  riskScore: number | null;
  blastRadius: string | null;
  autoApprovable: boolean;
  policyVersion: string | null;
  status: string;
  decision: Record<string, unknown> | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  resumedAt: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  eventCount: number;
  latestEventAt: string | null;
  events?: ApprovalEvent[];
};

type ApprovalRow = {
  id: string;
  run_id: string | null;
  task_id: string | null;
  agent_id: string;
  action_type: string;
  proposal: unknown;
  diff: unknown;
  rationale: string | null;
  risk_level: "p0" | "p1" | "p2" | "p3";
  risk_score: number | null;
  blast_radius: string | null;
  auto_approvable: boolean;
  policy_version: string | null;
  status: string;
  decision: unknown;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  created_at: Date;
  expires_at: Date | null;
  resumed_at: Date | null;
  executed_at: Date | null;
  execution_result: unknown;
  event_count: number;
  latest_event_at: Date | null;
};

type ApprovalEventRow = {
  id: number;
  approval_id: string;
  event_type: string;
  actor: string | null;
  payload: unknown;
  created_at: Date;
};

const normalizeObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");

const mapApproval = (row: ApprovalRow): ApprovalRequest => ({
  id: row.id,
  runId: row.run_id,
  taskId: row.task_id,
  agentId: row.agent_id,
  actionType: row.action_type,
  proposal: normalizeObject(row.proposal),
  diff: row.diff && typeof row.diff === "object" && !Array.isArray(row.diff) ? (row.diff as Record<string, unknown>) : null,
  rationale: row.rationale,
  riskLevel: row.risk_level,
  riskScore: row.risk_score,
  blastRadius: row.blast_radius,
  autoApprovable: row.auto_approvable,
  policyVersion: row.policy_version,
  status: row.status,
  decision: row.decision && typeof row.decision === "object" && !Array.isArray(row.decision) ? (row.decision as Record<string, unknown>) : null,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
  rejectedBy: row.rejected_by,
  rejectedAt: row.rejected_at ? row.rejected_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  resumedAt: row.resumed_at ? row.resumed_at.toISOString() : null,
  executedAt: row.executed_at ? row.executed_at.toISOString() : null,
  executionResult: row.execution_result && typeof row.execution_result === "object" && !Array.isArray(row.execution_result)
    ? (row.execution_result as Record<string, unknown>)
    : null,
  eventCount: Number(row.event_count || 0),
  latestEventAt: row.latest_event_at ? row.latest_event_at.toISOString() : null,
});

const mapEvent = (row: ApprovalEventRow): ApprovalEvent => ({
  id: row.id,
  approvalId: row.approval_id,
  eventType: row.event_type,
  actor: row.actor,
  payload: normalizeObject(row.payload),
  createdAt: row.created_at.toISOString(),
});

export async function getApprovals(filters: ApprovalFilters = {}): Promise<ApprovalRequest[]> {
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const rangeHours = Math.max(1, Math.min(filters.rangeHours ?? 168, 24 * 30));

  const conditions: string[] = [
    `r.created_at >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  if (filters.status && filters.status !== "all") {
    conditions.push(`r.status = '${escapeLiteral(filters.status)}'`);
  }

  if (filters.risk_level) {
    conditions.push(`r.risk_level = '${escapeLiteral(filters.risk_level)}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      r.id,
      r.run_id,
      r.task_id,
      r.agent_id,
      r.action_type,
      r.proposal,
      r.diff,
      r.rationale,
      r.risk_level,
      r.risk_score,
      r.blast_radius,
      r.auto_approvable,
      r.policy_version,
      r.status,
      r.decision,
      r.approved_by,
      r.approved_at,
      r.rejected_by,
      r.rejected_at,
      r.created_at,
      r.expires_at,
      r.resumed_at,
      r.executed_at,
      r.execution_result,
      COUNT(e.id)::int AS event_count,
      MAX(e.created_at) AS latest_event_at
    FROM mc_approval_requests r
    LEFT JOIN mc_approval_events e ON e.approval_id = r.id
    ${whereClause}
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) =>
    client.$queryRawUnsafe<ApprovalRow[]>(query);

  try {
    const rows = await runQuery(preferred);
    return rows.map(mapApproval);
  } catch (error) {
    if (!taskPrisma) throw error;
    const rows = await runQuery(prisma);
    return rows.map(mapApproval);
  }
}

export async function getApprovalById(id: string): Promise<ApprovalRequest | null> {
  const safeId = escapeLiteral(id);
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const approvalQuery = `
    SELECT
      r.id,
      r.run_id,
      r.task_id,
      r.agent_id,
      r.action_type,
      r.proposal,
      r.diff,
      r.rationale,
      r.risk_level,
      r.risk_score,
      r.blast_radius,
      r.auto_approvable,
      r.policy_version,
      r.status,
      r.decision,
      r.approved_by,
      r.approved_at,
      r.rejected_by,
      r.rejected_at,
      r.created_at,
      r.expires_at,
      r.resumed_at,
      r.executed_at,
      r.execution_result,
      COUNT(e.id)::int AS event_count,
      MAX(e.created_at) AS latest_event_at
    FROM mc_approval_requests r
    LEFT JOIN mc_approval_events e ON e.approval_id = r.id
    WHERE r.id = '${safeId}'
    GROUP BY r.id
    LIMIT 1
  `;

  const eventsQuery = `
    SELECT id, approval_id, event_type, actor, payload, created_at
    FROM mc_approval_events
    WHERE approval_id = '${safeId}'
    ORDER BY created_at ASC
  `;

  const run = async (client: typeof prisma) => {
    const [approvalRows, eventRows] = await Promise.all([
      client.$queryRawUnsafe<ApprovalRow[]>(approvalQuery),
      client.$queryRawUnsafe<ApprovalEventRow[]>(eventsQuery),
    ]);
    return { approvalRows, eventRows };
  };

  try {
    const { approvalRows, eventRows } = await run(preferred);
    if (approvalRows.length === 0) return null;
    return { ...mapApproval(approvalRows[0]), events: eventRows.map(mapEvent) };
  } catch (error) {
    if (!taskPrisma) throw error;
    const { approvalRows, eventRows } = await run(prisma);
    if (approvalRows.length === 0) return null;
    return { ...mapApproval(approvalRows[0]), events: eventRows.map(mapEvent) };
  }
}

export async function updateApprovalStatus(
  id: string,
  action: "approve" | "reject" | "approve_edited",
  decision?: Record<string, unknown>,
  actor?: string,
): Promise<void> {
  const safeId = escapeLiteral(id);
  const safeActor = actor ? `'${escapeLiteral(actor)}'` : "NULL";
  const decisionJson = decision ? `'${JSON.stringify(decision).replaceAll("'", "''")}'::jsonb` : "NULL";

  const status = action === "reject" ? "rejected" : action === "approve_edited" ? "approved_edited" : "approved";

  const updateSql = `
    UPDATE mc_approval_requests
    SET
      status = '${status}',
      decision = COALESCE(${decisionJson}, decision),
      approved_by = CASE WHEN '${status}' IN ('approved','approved_edited') THEN COALESCE(${safeActor}, approved_by) ELSE approved_by END,
      approved_at = CASE WHEN '${status}' IN ('approved','approved_edited') THEN NOW() ELSE approved_at END,
      rejected_by = CASE WHEN '${status}' = 'rejected' THEN COALESCE(${safeActor}, rejected_by) ELSE rejected_by END,
      rejected_at = CASE WHEN '${status}' = 'rejected' THEN NOW() ELSE rejected_at END
    WHERE id = '${safeId}'
  `;

  const eventPayload = decision ? decisionJson : "NULL";
  const eventSql = `
    INSERT INTO mc_approval_events (approval_id, event_type, actor, payload)
    VALUES ('${safeId}', '${action}', ${safeActor}, ${eventPayload})
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(updateSql);
    await client.$executeRawUnsafe(eventSql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}
