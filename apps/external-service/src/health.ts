export type HealthState = "healthy" | "unhealthy" | "ok" | "degraded";

export interface AggregateHealthInput {
  whoop: Record<string, unknown>;
  tonal: Record<string, unknown>;
  alpaca: Record<string, unknown>;
  appleHealth: Record<string, unknown>;
}

export interface AggregateHealthOutput extends AggregateHealthInput {
  status: "ok" | "degraded" | "unhealthy";
  statusCode: 200 | 503;
}

function isHealthy(entry: Record<string, unknown>): boolean {
  return entry.status === "healthy";
}

function isInactive(entry: Record<string, unknown>): boolean {
  return entry.status === "inactive";
}

export function buildAggregateHealth(input: AggregateHealthInput): AggregateHealthOutput {
  const entries = [input.whoop, input.tonal, input.alpaca, input.appleHealth];
  const activeEntries = entries.filter((e) => !isInactive(e));
  const healthyCount = activeEntries.filter(isHealthy).length;
  const activeCount = activeEntries.length;

  const status: AggregateHealthOutput["status"] =
    activeCount === 0 ? "ok" : healthyCount === activeCount ? "ok" : healthyCount === 0 ? "unhealthy" : "degraded";

  return {
    status,
    statusCode: status === "unhealthy" ? 503 : 200,
    whoop: input.whoop,
    tonal: input.tonal,
    alpaca: input.alpaca,
    appleHealth: input.appleHealth,
  };
}
