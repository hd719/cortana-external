export type AgentHealthBand = "healthy" | "degraded" | "critical";

export type AgentOperationalStats = {
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  completedTasks: number;
  failedTasks: number;
};

export type AgentRecentRun = {
  status: "completed" | "failed" | "cancelled";
  timestamp: Date | string | number;
};

export const deriveHealthBand = (score: number): AgentHealthBand => {
  if (score >= 75) return "healthy";
  if (score >= 45) return "degraded";
  return "critical";
};

const RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toTimestamp = (value: Date | string | number) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const computeHealthScore = (
  stats: AgentOperationalStats,
  recentRuns?: AgentRecentRun[]
) => {
  const runTerminal = stats.completedRuns + stats.failedRuns + stats.cancelledRuns;
  const taskTerminal = stats.completedTasks + stats.failedTasks;

  const runReliability = runTerminal > 0 ? stats.completedRuns / runTerminal : null;
  const taskReliability = taskTerminal > 0 ? stats.completedTasks / taskTerminal : null;

  const lifetimeReliability =
    runReliability !== null && taskReliability !== null
      ? runReliability * 0.6 + taskReliability * 0.4
      : runReliability ?? taskReliability ?? 0.6;

  const now = Date.now();
  const recentTerminalRuns = (recentRuns || []).filter((run) => {
    const timestamp = toTimestamp(run.timestamp);
    return Number.isFinite(timestamp) && now - timestamp <= RECENT_WINDOW_MS;
  });

  const recentRunSuccessRate =
    recentTerminalRuns.length > 0
      ? recentTerminalRuns.filter((run) => run.status === "completed").length /
        recentTerminalRuns.length
      : null;

  const blendedReliability =
    recentRunSuccessRate === null
      ? lifetimeReliability
      : lifetimeReliability * 0.6 + recentRunSuccessRate * 0.4;

  const recencyDelta =
    recentRunSuccessRate === null
      ? 0
      : recentRunSuccessRate - (runReliability ?? lifetimeReliability);

  const recencyMultiplier =
    recentRunSuccessRate === null ? 1 : clamp(1 + recencyDelta * 0.25, 0.88, 1.12);

  const reliabilityScore = blendedReliability * 70 * recencyMultiplier;

  // Use a square-root curve so early wins matter without hitting a hard plateau after ~6 runs.
  // This keeps scores responsive to new successful runs for mature agents.
  const completionVolume = Math.min(
    30,
    Math.sqrt(stats.completedRuns * 36 + stats.completedTasks * 9)
  );

  const rawScore = Math.max(0, Math.min(100, reliabilityScore + completionVolume));
  return rawScore;
};
