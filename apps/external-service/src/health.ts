export type HealthState = "healthy" | "unhealthy" | "ok" | "degraded";

export interface AggregateHealthInput {
  whoop: Record<string, unknown>;
  tonal: Record<string, unknown>;
  alpaca: Record<string, unknown>;
}

export interface AggregateHealthOutput extends AggregateHealthInput {
  status: "ok" | "degraded" | "unhealthy";
  statusCode: 200 | 503;
}

function isHealthy(entry: Record<string, unknown>): boolean {
  return entry.status === "healthy";
}

export function buildAggregateHealth(input: AggregateHealthInput): AggregateHealthOutput {
  const healthyCount = [input.whoop, input.tonal, input.alpaca].filter(isHealthy).length;

  const status: AggregateHealthOutput["status"] =
    healthyCount === 3 ? "ok" : healthyCount === 0 ? "unhealthy" : "degraded";

  return {
    status,
    statusCode: status === "unhealthy" ? 503 : 200,
    whoop: input.whoop,
    tonal: input.tonal,
    alpaca: input.alpaca,
  };
}
