import { execFileSync } from "node:child_process";
import { loadMissionControlScriptEnv } from "@/lib/script-env";

export type HumanRequiredAction = {
  id: number;
  system: string;
  category: string;
  severity: string;
  status: string;
  summary: string;
  requiredAction: string;
  lastSeenAt: string;
  dueAt: string | null;
  verificationKey: string | null;
  alertCount: number;
  detectionCount: number;
};

function runPsqlJson(sql: string): unknown[] {
  const stdout = execFileSync("/opt/homebrew/opt/postgresql@17/bin/psql", [
    process.env.CORTANA_DB ?? "cortana",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ], {
    encoding: "utf8",
    env: loadMissionControlScriptEnv(undefined, process.env),
  }).trim();
  return stdout ? JSON.parse(stdout) as unknown[] : [];
}

export function listHumanRequiredActions(limit = 25): HumanRequiredAction[] {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = runPsqlJson(`
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT id, system, category, severity, status, summary, required_action, last_seen_at, due_at, verification_key, alert_count, detection_count
  FROM cortana_human_required_actions
  WHERE status = 'open'
  ORDER BY
    CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    COALESCE(due_at, last_seen_at) ASC
  LIMIT ${safeLimit}
) t;
`);
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)).map((row) => ({
    id: Number(row.id),
    system: String(row.system ?? "system"),
    category: String(row.category ?? "human_setup"),
    severity: String(row.severity ?? "warning"),
    status: String(row.status ?? "open"),
    summary: String(row.summary ?? "Human action required"),
    requiredAction: String(row.required_action ?? "Review locally."),
    lastSeenAt: String(row.last_seen_at ?? ""),
    dueAt: row.due_at == null ? null : String(row.due_at),
    verificationKey: row.verification_key == null ? null : String(row.verification_key),
    alertCount: Number(row.alert_count ?? 0),
    detectionCount: Number(row.detection_count ?? 0),
  }));
}
