import fs from "node:fs";
import path from "node:path";
import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import prisma from "@/lib/prisma";
import { getCortanaSourceRepo } from "@/lib/runtime-paths";
import { loadMissionControlScriptEnv } from "@/lib/script-env";
import {
  buildVacationTierRollup,
  countVacationIncidents,
  countVacationSystemsByTier,
  type VacationTierRollup,
} from "@/lib/vacation-ops-model";

export type { VacationTierRollup } from "@/lib/vacation-ops-model";

const execFileAsync = promisify(execFile);

const CORTANA_ROOT = getCortanaSourceRepo();
const VACATION_CONFIG_PATH = path.join(CORTANA_ROOT, "config", "vacation-ops.json");
const VACATION_TOOL_PATH = path.join(CORTANA_ROOT, "tools", "vacation", "vacation-ops.ts");
const VACATION_MIRROR_PATH = path.join(process.env.HOME ?? "/Users/hd", ".openclaw", "state", "vacation-mode.json");
const COMMAND_TIMEOUT_MS = 180_000;
const STALE_PREP_MS = 15 * 60 * 1000;

type JsonObject = Record<string, unknown>;

type RawWindowRow = {
  id: number;
  label: string;
  status: string;
  timezone: string;
  start_at: Date | string;
  end_at: Date | string;
  prep_recommended_at: Date | string | null;
  prep_started_at: Date | string | null;
  prep_completed_at: Date | string | null;
  enabled_at: Date | string | null;
  disabled_at: Date | string | null;
  disable_reason: string | null;
  trigger_source: string;
  created_by: string;
  config_snapshot: JsonObject | null;
  state_snapshot: JsonObject | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RawRunRow = {
  id: number;
  vacation_window_id: number | null;
  run_type: string;
  trigger_source: string;
  dry_run: boolean;
  readiness_outcome: string | null;
  summary_status: string | null;
  summary_payload: JsonObject | null;
  summary_text: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  state: string;
};

type RawCheckRow = {
  id: number;
  run_id: number;
  system_key: string;
  tier: number;
  status: string;
  observed_at: Date | string;
  freshness_at: Date | string | null;
  remediation_attempted: boolean;
  remediation_succeeded: boolean;
  autonomy_incident_id: number | null;
  incident_key: string | null;
  detail: JsonObject | null;
};

type RawIncidentRow = {
  id: number;
  vacation_window_id: number;
  run_id: number | null;
  latest_check_result_id: number | null;
  latest_action_id: number | null;
  system_key: string;
  tier: number;
  status: string;
  human_required: boolean;
  first_observed_at: Date | string;
  last_observed_at: Date | string;
  resolved_at: Date | string | null;
  resolution_reason: string | null;
  symptom: string | null;
  detail: JsonObject | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RawActionRow = {
  id: number;
  vacation_window_id: number;
  run_id: number | null;
  autonomy_incident_id: number | null;
  incident_key: string | null;
  system_key: string;
  step_order: number;
  action_kind: string;
  action_status: string;
  verification_status: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  detail: JsonObject | null;
};

type VacationConfig = {
  version: number;
  timezone: string;
  summaryTimes: {
    morning: string;
    evening: string;
  };
  pausedJobIds: string[];
  remediationLadder: string[];
  systems: Record<string, {
    tier: number;
    required: boolean;
    probe: string;
    freshnessSource: string;
    tier2Class?: string;
    remediation: string[];
  }>;
};

export type VacationWindow = {
  id: number;
  label: string;
  status: string;
  timezone: string;
  startAt: string;
  endAt: string;
  prepRecommendedAt: string | null;
  prepStartedAt: string | null;
  prepCompletedAt: string | null;
  enabledAt: string | null;
  disabledAt: string | null;
  disableReason: string | null;
  triggerSource: string;
  createdBy: string;
  configSnapshot: JsonObject;
  stateSnapshot: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type VacationRun = {
  id: number;
  vacationWindowId: number | null;
  runType: string;
  triggerSource: string;
  dryRun: boolean;
  readinessOutcome: string | null;
  summaryStatus: string | null;
  summaryPayload: JsonObject;
  summaryText: string;
  startedAt: string;
  completedAt: string | null;
  state: string;
};

export type VacationCheck = {
  id: number;
  runId: number;
  systemKey: string;
  systemLabel: string;
  tier: number;
  status: string;
  observedAt: string;
  freshnessAt: string | null;
  freshnessSource: string | null;
  remediationAttempted: boolean;
  remediationSucceeded: boolean;
  autonomyIncidentId: number | null;
  incidentKey: string | null;
  detail: JsonObject;
};

export type VacationIncident = {
  id: number;
  vacationWindowId: number;
  runId: number | null;
  latestCheckResultId: number | null;
  latestActionId: number | null;
  systemKey: string;
  systemLabel: string;
  tier: number;
  status: string;
  humanRequired: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  symptom: string | null;
  detail: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type VacationAction = {
  id: number;
  vacationWindowId: number;
  runId: number | null;
  autonomyIncidentId: number | null;
  incidentKey: string | null;
  systemKey: string;
  systemLabel: string;
  stepOrder: number;
  actionKind: string;
  actionStatus: string;
  verificationStatus: string | null;
  startedAt: string;
  completedAt: string | null;
  detail: JsonObject;
};

export type VacationOpsSnapshot = {
  generatedAt: string;
  mode: string;
  config: {
    timezone: string;
    summaryTimes: {
      morning: string;
      evening: string;
    };
    pausedJobIds: string[];
    remediationLadder: string[];
    systemCount: number;
    systemKeys: string[];
    tierCounts: Record<string, number>;
  };
  recommendation: {
    timezone: string;
    recommendedPrepAt: string;
    startAt: string;
    endAt: string;
    reason: string;
  };
  latestWindow: VacationWindow | null;
  activeWindow: VacationWindow | null;
  latestReadiness: VacationRun | null;
  latestSummary: VacationRun | null;
  mirror: JsonObject | null;
  nextSummaryAt: string | null;
  latestChecks: VacationCheck[];
  recentIncidents: VacationIncident[];
  recentActions: VacationAction[];
  tierRollup: VacationTierRollup[];
  counts: {
    activeIncidents: number;
    humanRequiredIncidents: number;
    resolvedIncidents: number;
    pausedJobs: number;
    selfHeals: number;
  };
  enableReadyWindowId: number | null;
  pausedJobs: Array<{
    id: string;
    name: string;
  }>;
};

export type VacationActionKey = "prep" | "enable" | "disable" | "unpause" | "cancel";

export function formatVacationWindowLabel(label: string | null | undefined): string {
  if (!label) return "—";
  const match = label.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return label;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

export function deriveVacationDisplayMode(
  activeWindow: Pick<VacationWindow, "status"> | null,
  latestWindow: Pick<VacationWindow, "status"> | null,
): "active" | "ready" | "prep" | "inactive" {
  if (activeWindow?.status === "active") return "active";
  if (latestWindow?.status === "ready") return "ready";
  if (latestWindow?.status === "prep") return "prep";
  return "inactive";
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function parseMs(value: Date | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectLatestVacationCheckRows<T extends { system_key: string; observed_at: Date | string }>(rows: T[]): T[] {
  const latestBySystem = new Map<string, T>();
  for (const row of rows) {
    const previous = latestBySystem.get(row.system_key);
    if (!previous || parseMs(row.observed_at) >= parseMs(previous.observed_at)) {
      latestBySystem.set(row.system_key, row);
    }
  }
  return Array.from(latestBySystem.values()).sort((left, right) => {
    const tierDiff = Number((left as { tier?: number }).tier ?? 0) - Number((right as { tier?: number }).tier ?? 0);
    return tierDiff || left.system_key.localeCompare(right.system_key);
  });
}

function readinessOutcomeToWindowStatus(outcome: string | null | undefined): "ready" | "failed" | null {
  if (outcome === "pass" || outcome === "warn") return "ready";
  if (outcome === "fail" || outcome === "no_go") return "failed";
  return null;
}

export function deriveVacationPrepRepair(
  latestWindow: Pick<VacationWindow, "id" | "status"> | null,
  latestReadiness: Pick<VacationRun, "id" | "vacationWindowId" | "state" | "readinessOutcome" | "startedAt" | "completedAt"> | null,
  now = new Date(),
): {
  nextWindowStatus: "ready" | "failed";
  cancelLatestRun: boolean;
  note: string;
  prepCompletedAt: string;
} | null {
  if (!latestWindow || latestWindow.status !== "prep" || !latestReadiness || latestReadiness.vacationWindowId !== latestWindow.id) {
    return null;
  }

  if (latestReadiness.state === "completed") {
    const nextWindowStatus = readinessOutcomeToWindowStatus(latestReadiness.readinessOutcome);
    if (!nextWindowStatus) return null;
    return {
      nextWindowStatus,
      cancelLatestRun: false,
      note: `Recovered staged vacation window from completed readiness run ${latestReadiness.id}.`,
      prepCompletedAt: latestReadiness.completedAt ?? now.toISOString(),
    };
  }

  if (latestReadiness.state !== "running") return null;
  const startedAtMs = parseMs(latestReadiness.startedAt);
  if (!startedAtMs || now.getTime() - startedAtMs < STALE_PREP_MS) return null;
  return {
    nextWindowStatus: "failed",
    cancelLatestRun: true,
    note: `Cancelled stale readiness run ${latestReadiness.id} after staged preflight exceeded 15 minutes.`,
    prepCompletedAt: now.toISOString(),
  };
}

function normalizeIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

const REMOVED_VACATION_DETAIL_TERMS = ["alpaca", "fred", "backtester"];

function isRemovedVacationDetailTerm(value: unknown): boolean {
  return typeof value === "string" && REMOVED_VACATION_DETAIL_TERMS.some((term) => value.toLowerCase().includes(term));
}

function sanitizeVacationValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        const object = asObject(item);
        return !isRemovedVacationDetailTerm(object.key) && !isRemovedVacationDetailTerm(object.label);
      })
      .map(sanitizeVacationValue);
  }

  const object = asObject(value);
  if (Object.keys(object).length === 0 || object !== value) return value;

  const sanitized: JsonObject = {};
  for (const [key, currentValue] of Object.entries(object)) {
    if (isRemovedVacationDetailTerm(key)) continue;
    sanitized[key] = sanitizeVacationValue(currentValue);
  }
  return sanitized;
}

export function sanitizeVacationDetail(systemKey: string, detail: JsonObject): JsonObject {
  const sanitized = sanitizeVacationValue(detail) as JsonObject;
  if (systemKey === "financial_external_services") {
    sanitized.summary = "Schwab market-data ops readiness checked.";
  }
  return sanitized;
}

function readVacationConfig(): VacationConfig {
  return JSON.parse(fs.readFileSync(VACATION_CONFIG_PATH, "utf8")) as VacationConfig;
}

function readVacationMirror(): JsonObject | null {
  try {
    return JSON.parse(fs.readFileSync(VACATION_MIRROR_PATH, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}

export function formatVacationSystemLabel(systemKey: string): string {
  if (systemKey === "financial_external_services") return "Schwab Market Data";
  return systemKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapWindow(row: RawWindowRow | null): VacationWindow | null {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    timezone: row.timezone,
    startAt: normalizeIso(row.start_at) ?? "",
    endAt: normalizeIso(row.end_at) ?? "",
    prepRecommendedAt: normalizeIso(row.prep_recommended_at),
    prepStartedAt: normalizeIso(row.prep_started_at),
    prepCompletedAt: normalizeIso(row.prep_completed_at),
    enabledAt: normalizeIso(row.enabled_at),
    disabledAt: normalizeIso(row.disabled_at),
    disableReason: row.disable_reason,
    triggerSource: row.trigger_source,
    createdBy: row.created_by,
    configSnapshot: asObject(row.config_snapshot),
    stateSnapshot: asObject(row.state_snapshot),
    createdAt: normalizeIso(row.created_at) ?? "",
    updatedAt: normalizeIso(row.updated_at) ?? "",
  };
}

function mapRun(row: RawRunRow | null): VacationRun | null {
  if (!row) return null;
  return {
    id: row.id,
    vacationWindowId: row.vacation_window_id,
    runType: row.run_type,
    triggerSource: row.trigger_source,
    dryRun: Boolean(row.dry_run),
    readinessOutcome: row.readiness_outcome,
    summaryStatus: row.summary_status,
    summaryPayload: asObject(row.summary_payload),
    summaryText: row.summary_text,
    startedAt: normalizeIso(row.started_at) ?? "",
    completedAt: normalizeIso(row.completed_at),
    state: row.state,
  };
}

function mapCheck(row: RawCheckRow, config: VacationConfig): VacationCheck {
  return {
    id: row.id,
    runId: row.run_id,
    systemKey: row.system_key,
    systemLabel: formatVacationSystemLabel(row.system_key),
    tier: row.tier,
    status: row.status,
    observedAt: normalizeIso(row.observed_at) ?? "",
    freshnessAt: normalizeIso(row.freshness_at),
    freshnessSource: config.systems[row.system_key]?.freshnessSource ?? null,
    remediationAttempted: Boolean(row.remediation_attempted),
    remediationSucceeded: Boolean(row.remediation_succeeded),
    autonomyIncidentId: row.autonomy_incident_id,
    incidentKey: row.incident_key,
    detail: sanitizeVacationDetail(row.system_key, asObject(row.detail)),
  };
}

function mapIncident(row: RawIncidentRow): VacationIncident {
  return {
    id: row.id,
    vacationWindowId: row.vacation_window_id,
    runId: row.run_id,
    latestCheckResultId: row.latest_check_result_id,
    latestActionId: row.latest_action_id,
    systemKey: row.system_key,
    systemLabel: formatVacationSystemLabel(row.system_key),
    tier: row.tier,
    status: row.status,
    humanRequired: Boolean(row.human_required),
    firstObservedAt: normalizeIso(row.first_observed_at) ?? "",
    lastObservedAt: normalizeIso(row.last_observed_at) ?? "",
    resolvedAt: normalizeIso(row.resolved_at),
    resolutionReason: row.resolution_reason,
    symptom: row.symptom,
    detail: asObject(row.detail),
    createdAt: normalizeIso(row.created_at) ?? "",
    updatedAt: normalizeIso(row.updated_at) ?? "",
  };
}

function mapAction(row: RawActionRow): VacationAction {
  return {
    id: row.id,
    vacationWindowId: row.vacation_window_id,
    runId: row.run_id,
    autonomyIncidentId: row.autonomy_incident_id,
    incidentKey: row.incident_key,
    systemKey: row.system_key,
    systemLabel: formatVacationSystemLabel(row.system_key),
    stepOrder: row.step_order,
    actionKind: row.action_kind,
    actionStatus: row.action_status,
    verificationStatus: row.verification_status,
    startedAt: normalizeIso(row.started_at) ?? "",
    completedAt: normalizeIso(row.completed_at),
    detail: asObject(row.detail),
  };
}

function buildRecommendation(timezone: string) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    timezone,
    recommendedPrepAt: new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    reason: "Start prep roughly 24 hours before departure so auth refreshes and exact smokes can be rerun before leaving.",
  };
}

export function computeNextSummaryAt(summaryTimes: VacationConfig["summaryTimes"], activeWindow: VacationWindow | null, now = new Date()): string | null {
  if (!activeWindow) return null;

  const zonedNow = new Date(now.toLocaleString("en-US", { timeZone: activeWindow.timezone }));
  const offsetMs = now.getTime() - zonedNow.getTime();

  const candidates = [summaryTimes.morning, summaryTimes.evening]
    .map((value) => {
      const [hourText, minuteText] = value.split(":");
      const candidate = new Date(zonedNow);
      candidate.setSeconds(0, 0);
      candidate.setHours(Number(hourText), Number(minuteText), 0, 0);
      if (candidate.getTime() <= zonedNow.getTime()) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return new Date(candidate.getTime() + offsetMs);
    })
    .sort((left, right) => left.getTime() - right.getTime());

  return candidates[0]?.toISOString() ?? null;
}

function extractPausedJobs(window: VacationWindow | null, mirror: JsonObject | null): number {
  const fromWindow = Array.isArray(window?.stateSnapshot?.paused_job_ids) ? window?.stateSnapshot?.paused_job_ids.length : 0;
  const fromMirror = Array.isArray(mirror?.pausedJobIds) ? mirror.pausedJobIds.length : 0;
  return Math.max(fromWindow ?? 0, fromMirror ?? 0);
}

function resolvePausedJobs(config: VacationConfig, window: VacationWindow | null, mirror: JsonObject | null) {
  const configuredJobs = new Map(config.pausedJobIds.map((id) => [id, ""]));
  const snapshotIds = Array.isArray(window?.stateSnapshot?.paused_job_ids)
    ? window?.stateSnapshot?.paused_job_ids.map((value) => String(value))
    : [];
  const mirrorIds = Array.isArray(mirror?.pausedJobIds)
    ? mirror.pausedJobIds.map((value) => String(value))
    : [];
  const activeIds = Array.from(new Set([...snapshotIds, ...mirrorIds].filter(Boolean)));
  const knownJobs = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(CORTANA_ROOT, "config", "cron", "jobs.json"), "utf8");
    const parsed = JSON.parse(raw) as { jobs?: Array<{ id?: string; name?: string }> };
    for (const job of parsed.jobs ?? []) {
      const id = String(job.id ?? "");
      const name = String(job.name ?? "").trim();
      if (id && name) knownJobs.set(id, name);
    }
  } catch {
    // best-effort name resolution only
  }

  return activeIds
    .filter((id) => configuredJobs.has(id) || knownJobs.has(id))
    .map((id) => ({
      id,
      name: knownJobs.get(id) ?? id,
    }));
}

async function queryFirst<T>(sql: string): Promise<T | null> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql);
  return rows[0] ?? null;
}

async function queryMany<T>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

async function reconcileVacationSnapshotState(
  latestWindowRow: RawWindowRow | null,
  latestReadinessRow: RawRunRow | null,
): Promise<{ latestWindowRow: RawWindowRow | null; latestReadinessRow: RawRunRow | null }> {
  const latestWindow = mapWindow(latestWindowRow);
  const latestReadiness = mapRun(latestReadinessRow);
  const repair = deriveVacationPrepRepair(latestWindow, latestReadiness);
  if (!repair || !latestWindowRow) {
    return { latestWindowRow, latestReadinessRow };
  }

  const note = sqlEscape(repair.note);
  const prepCompletedAt = sqlEscape(repair.prepCompletedAt);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`
UPDATE cortana_vacation_windows
SET status = '${repair.nextWindowStatus}',
    prep_completed_at = COALESCE(prep_completed_at, '${prepCompletedAt}'),
    updated_at = NOW()
WHERE id = ${latestWindowRow.id}
  AND status = 'prep';
`);

    const runningFilter = repair.cancelLatestRun
      ? `id = ${latestReadinessRow?.id ?? 0}`
      : `id <> ${latestReadinessRow?.id ?? 0}`;

    await tx.$queryRawUnsafe(`
UPDATE cortana_vacation_runs
SET state = 'cancelled',
    completed_at = COALESCE(completed_at, NOW()),
    summary_payload = COALESCE(summary_payload, '{}'::jsonb) || jsonb_build_object('note', '${note}'),
    summary_text = CASE
      WHEN COALESCE(summary_text, '') = '' THEN '${note}'
      ELSE summary_text
    END
WHERE vacation_window_id = ${latestWindowRow.id}
  AND run_type = 'readiness'
  AND state = 'running'
  AND ${runningFilter};
`);
  });

  const [repairedWindowRow, repairedReadinessRow] = await Promise.all([
    queryFirst<RawWindowRow>(`SELECT * FROM cortana_vacation_windows WHERE id = ${latestWindowRow.id} LIMIT 1`),
    queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE vacation_window_id = ${latestWindowRow.id} AND run_type = 'readiness' ORDER BY started_at DESC LIMIT 1`),
  ]);

  return {
    latestWindowRow: repairedWindowRow ?? latestWindowRow,
    latestReadinessRow: repairedReadinessRow ?? latestReadinessRow,
  };
}

export async function getVacationOpsSnapshot(): Promise<VacationOpsSnapshot> {
  const config = readVacationConfig();
  let latestWindowRow = await queryFirst<RawWindowRow>(`SELECT * FROM cortana_vacation_windows ORDER BY updated_at DESC LIMIT 1`);
  const activeWindowRow = await queryFirst<RawWindowRow>(`SELECT * FROM cortana_vacation_windows WHERE status = 'active' ORDER BY start_at DESC LIMIT 1`);

  const initialRelevantWindowId = activeWindowRow?.id ?? latestWindowRow?.id ?? null;
  let latestReadinessRow = initialRelevantWindowId
    ? await queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE vacation_window_id = ${initialRelevantWindowId} AND run_type = 'readiness' ORDER BY started_at DESC LIMIT 1`)
    : await queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE run_type = 'readiness' ORDER BY started_at DESC LIMIT 1`);

  ({ latestWindowRow, latestReadinessRow } = await reconcileVacationSnapshotState(latestWindowRow, latestReadinessRow));

  const latestWindow = mapWindow(latestWindowRow);
  const activeWindow = mapWindow(activeWindowRow);
  const mirror = readVacationMirror();

  const relevantWindowId = activeWindow?.id ?? latestWindow?.id ?? null;
  latestReadinessRow = relevantWindowId
    ? await queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE vacation_window_id = ${relevantWindowId} AND run_type = 'readiness' ORDER BY started_at DESC LIMIT 1`)
    : await queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE run_type = 'readiness' ORDER BY started_at DESC LIMIT 1`);
  const latestReadiness = mapRun(latestReadinessRow);
  const latestReadinessRunId = latestReadiness?.id ?? null;

  const [latestSummaryRow, checkRows, incidentRows, actionRows] = await Promise.all([
    relevantWindowId
      ? queryFirst<RawRunRow>(`SELECT * FROM cortana_vacation_runs WHERE vacation_window_id = ${relevantWindowId} AND run_type IN ('summary_morning', 'summary_evening') ORDER BY started_at DESC LIMIT 1`)
      : Promise.resolve(null),
    latestReadinessRunId
      ? queryMany<RawCheckRow>(`SELECT * FROM cortana_vacation_check_results WHERE run_id = ${latestReadinessRunId} ORDER BY tier ASC, system_key ASC`)
      : Promise.resolve([]),
    relevantWindowId
      ? queryMany<RawIncidentRow>(`SELECT * FROM cortana_vacation_incidents WHERE vacation_window_id = ${relevantWindowId} ORDER BY updated_at DESC LIMIT 12`)
      : Promise.resolve([]),
    relevantWindowId
      ? queryMany<RawActionRow>(`SELECT * FROM cortana_vacation_actions WHERE vacation_window_id = ${relevantWindowId} ORDER BY started_at DESC LIMIT 12`)
      : Promise.resolve([]),
  ]);

  const latestSummary = mapRun(latestSummaryRow);
  const latestChecks = selectLatestVacationCheckRows(checkRows).map((row) => mapCheck(row, config));
  const recentIncidents = incidentRows.map(mapIncident);
  const recentActions = actionRows.map(mapAction);
  const tierRollup = buildVacationTierRollup(latestChecks);
  const incidentCounts = countVacationIncidents(recentIncidents);
  const mode = deriveVacationDisplayMode(activeWindow, latestWindow);
  const pausedJobs = resolvePausedJobs(config, activeWindow ?? latestWindow, mirror);

  return {
    generatedAt: new Date().toISOString(),
    mode,
    config: {
      timezone: config.timezone,
      summaryTimes: config.summaryTimes,
      pausedJobIds: config.pausedJobIds,
      remediationLadder: config.remediationLadder,
      systemCount: Object.keys(config.systems).length,
      systemKeys: Object.keys(config.systems),
      tierCounts: countVacationSystemsByTier(config.systems),
    },
    recommendation: buildRecommendation(config.timezone),
    latestWindow,
    activeWindow,
    latestReadiness,
    latestSummary,
    mirror,
    nextSummaryAt: computeNextSummaryAt(config.summaryTimes, activeWindow),
    latestChecks,
    recentIncidents,
    recentActions,
    tierRollup,
    counts: {
      activeIncidents: incidentCounts.activeIncidents,
      humanRequiredIncidents: incidentCounts.humanRequiredIncidents,
      resolvedIncidents: incidentCounts.resolvedIncidents,
      pausedJobs: extractPausedJobs(activeWindow ?? latestWindow, mirror),
      selfHeals: incidentCounts.selfHeals,
    },
    enableReadyWindowId:
      latestWindow?.status === "ready" && latestReadiness?.vacationWindowId === latestWindow.id
        ? latestWindow.id
        : null,
    pausedJobs,
  };
}

function buildExecEnv() {
  return loadMissionControlScriptEnv(process.cwd(), { ...process.env });
}

function parseJsonOutput(raw: string): JsonObject {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as JsonObject;
}

function describeExecFailure(error: unknown): string {
  if (!(error instanceof Error)) return "Vacation Ops command failed";
  const withStreams = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  const stderr = typeof withStreams.stderr === "string"
    ? withStreams.stderr.trim()
    : Buffer.isBuffer(withStreams.stderr)
      ? withStreams.stderr.toString("utf8").trim()
      : "";
  const stdout = typeof withStreams.stdout === "string"
    ? withStreams.stdout.trim()
    : Buffer.isBuffer(withStreams.stdout)
      ? withStreams.stdout.toString("utf8").trim()
      : "";
  return stderr || stdout || error.message;
}

export async function runVacationOpsAction(
  action: VacationActionKey,
  input: { startAt?: string; endAt?: string; timezone?: string; windowId?: number; reason?: string } = {},
) {
  const args = ["tsx", VACATION_TOOL_PATH, action];

  if (action === "prep") {
    if (!input.startAt || !input.endAt) {
      throw new Error("Prep requires startAt and endAt.");
    }
    args.push("--start", input.startAt, "--end", input.endAt);
    if (input.timezone) args.push("--timezone", input.timezone);
  }

  if (action === "enable") {
    if (input.windowId == null) {
      throw new Error("Enable requires a prepared vacation window.");
    }
    args.push("--window-id", String(input.windowId));
  }

  if (action === "disable") {
    args.push("--reason", input.reason ?? "manual");
  }

  if (action === "cancel" && input.windowId != null) {
    args.push("--window-id", String(input.windowId));
  }

  args.push("--json");

  try {
    const { stdout } = await execFileAsync("npx", args, {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
      env: buildExecEnv(),
    } as ExecFileOptionsWithStringEncoding);

    return parseJsonOutput(stdout);
  } catch (error) {
    throw new Error(describeExecFailure(error));
  }
}
