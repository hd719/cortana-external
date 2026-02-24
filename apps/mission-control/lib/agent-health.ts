export type AgentHealthBand = "healthy" | "degraded" | "critical";

export type AgentOperationalStats = {
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  completedTasks: number;
  failedTasks: number;
};

export const deriveHealthBand = (score: number): AgentHealthBand => {
  if (score >= 75) return "healthy";
  if (score >= 45) return "degraded";
  return "critical";
};

export const computeHealthScore = (stats: AgentOperationalStats) => {
  const runTerminal = stats.completedRuns + stats.failedRuns + stats.cancelledRuns;
  const taskTerminal = stats.completedTasks + stats.failedTasks;

  const runReliability = runTerminal > 0 ? stats.completedRuns / runTerminal : 0.6;
  const taskReliability = taskTerminal > 0 ? stats.completedTasks / taskTerminal : 0.6;

  const reliabilityScore = (runReliability * 0.6 + taskReliability * 0.4) * 70;

  // Use a square-root curve so early wins matter without hitting a hard plateau after ~6 runs.
  // This keeps scores responsive to new successful runs for mature agents.
  const completionVolume = Math.min(
    30,
    Math.sqrt(stats.completedRuns * 36 + stats.completedTasks * 9)
  );

  const rawScore = Math.max(0, Math.min(100, reliabilityScore + completionVolume));
  return Math.round(rawScore * 10) / 10;
};
