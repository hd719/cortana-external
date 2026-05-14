export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OpenClawLifecycleStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "killed";

export type OpenClawRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type OpenClawEventSeverity = "info" | "warning" | "critical";
export type OpenClawLaunchPhase = "phase1_queued" | "phase2_running_confirmed" | "phase2_running_unconfirmed" | "terminal";

export type OpenClawLifecycleEvent = {
  runId: string;
  status: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  jobType?: string;
  summary?: string;
  metadata?: JsonValue;
  timestamp?: string;
};

export type OpenClawRunStoreRecord = {
  runId: string;
  label?: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  endedReason?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
  outcome?: { status?: string };
  task?: JsonValue;
  agent?: string;
  role?: string;
  assigned_to?: string;
};

export type OpenClawRunStore = {
  runs?: Record<string, OpenClawRunStoreRecord>;
};

export const normalizeLifecycleStatus = (status: string): OpenClawLifecycleStatus | null => {
  const normalized = status.trim().toLowerCase();
  if (["queued", "running", "done", "failed", "timeout", "killed"].includes(normalized)) {
    return normalized as OpenClawLifecycleStatus;
  }

  if (["completed", "complete", "success", "succeeded", "ok"].includes(normalized)) {
    return "done";
  }

  if (["cancelled", "canceled", "aborted", "abort"].includes(normalized)) {
    return "killed";
  }

  if (["error", "errored"].includes(normalized)) {
    return "failed";
  }

  return null;
};

export const runStatusFromLifecycle = (status: OpenClawLifecycleStatus): OpenClawRunStatus => {
  if (status === "done") return "completed";
  if (status === "failed" || status === "timeout") return "failed";
  if (status === "killed") return "cancelled";
  if (status === "running") return "running";
  return "queued";
};

export const severityFromLifecycle = (status: OpenClawLifecycleStatus): OpenClawEventSeverity => {
  if (status === "failed" || status === "timeout" || status === "killed") return "critical";
  return "info";
};

export const isTerminalLifecycleStatus = (status: OpenClawLifecycleStatus) =>
  status === "done" || status === "failed" || status === "timeout" || status === "killed";

export const launchPhaseFromLifecycle = (
  status: OpenClawLifecycleStatus,
  existingExternalStatus?: string | null,
): OpenClawLaunchPhase => {
  if (status === "queued") return "phase1_queued";
  if (status !== "running") return "terminal";
  return existingExternalStatus === "queued" || !existingExternalStatus
    ? "phase2_running_confirmed"
    : "phase2_running_unconfirmed";
};

const toIso = (timestamp?: number) =>
  timestamp && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;

export const lifecycleStatusFromStoreRun = (run: OpenClawRunStoreRecord): OpenClawLifecycleStatus => {
  if (!run.endedAt) {
    return run.startedAt ? "running" : "queued";
  }

  return normalizeLifecycleStatus(run.outcome?.status || "") ?? "done";
};

export const isStoreRunActive = (run: OpenClawRunStoreRecord) => !run.endedAt && Boolean(run.runId);

export const lifecycleEventFromStoreRun = (
  run: OpenClawRunStoreRecord,
): OpenClawLifecycleEvent | null => {
  if (!run.runId) return null;

  const status = lifecycleStatusFromStoreRun(run);
  const timestamp = isTerminalLifecycleStatus(status)
    ? toIso(run.endedAt)
    : toIso(run.startedAt || run.createdAt);
  const summary =
    status === "running"
      ? `OpenClaw sub-agent ${run.runId} is running`
      : status === "queued"
        ? `OpenClaw sub-agent ${run.runId} queued`
        : `OpenClaw sub-agent ${run.runId} ${status}${run.endedReason ? ` (${run.endedReason})` : ""}`;

  return {
    runId: run.runId,
    status,
    agentName: run.agent,
    role: run.role,
    jobType: run.label || "openclaw-subagent",
    summary,
    timestamp,
    metadata: {
      source: "openclaw-runs-store",
      label: run.label ?? null,
      assigned_to: run.assigned_to ?? null,
      agent: run.agent ?? null,
      role: run.role ?? null,
      task: run.task ?? null,
      childSessionKey: run.childSessionKey ?? null,
      requesterSessionKey: run.requesterSessionKey ?? null,
      outcome: run.outcome ? { status: run.outcome.status ?? null } : null,
      endedReason: run.endedReason ?? null,
    },
  };
};
