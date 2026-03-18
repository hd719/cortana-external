import { buildAggregateHealth } from "../health.js";

describe("buildAggregateHealth", () => {
  it("returns ok when all providers are healthy", () => {
    const result = buildAggregateHealth({
      whoop: { status: "healthy" },
      tonal: { status: "healthy" },
      alpaca: { status: "healthy" },
    });

    expect(result.status).toBe("ok");
    expect(result.statusCode).toBe(200);
  });

  it("returns degraded when at least one provider is healthy", () => {
    const result = buildAggregateHealth({
      whoop: { status: "healthy" },
      tonal: { status: "unhealthy" },
      alpaca: { status: "healthy" },
    });

    expect(result.status).toBe("degraded");
    expect(result.statusCode).toBe(200);
  });

  it("returns unhealthy when no providers are healthy", () => {
    const result = buildAggregateHealth({
      whoop: { status: "ok" },
      tonal: { status: "unhealthy" },
      alpaca: { status: "unhealthy" },
    });

    expect(result.status).toBe("unhealthy");
    expect(result.statusCode).toBe(503);
  });
});
