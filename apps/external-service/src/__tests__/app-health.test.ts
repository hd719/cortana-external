import { createApp, type ExternalServices } from "../app.js";

function createServices(overrides?: Partial<ExternalServices>): ExternalServices {
  return {
    whoop: {
      getAggregateHealth: async () => ({ status: "healthy" }),
      warmup: async () => {},
      proactiveRefreshIfExpiring: async () => {},
    } as unknown as ExternalServices["whoop"],
    tonal: {
      getAggregateHealth: async () => ({ status: "healthy" }),
      warmup: async () => {},
      proactiveRefreshIfExpiring: async () => {},
    } as unknown as ExternalServices["tonal"],
    alpaca: {
      checkHealth: async () => ({ status: "healthy" }),
    } as unknown as ExternalServices["alpaca"],
    ...overrides,
  };
}

describe("/health", () => {
  it("returns ok when all providers are healthy", async () => {
    const app = createApp(createServices());
    const response = await app.request("/health");
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("returns degraded when one provider is unhealthy", async () => {
    const app = createApp(
      createServices({
        tonal: {
          getAggregateHealth: async () => ({ status: "unhealthy", error: "boom" }),
        } as unknown as ExternalServices["tonal"],
      }),
    );

    const response = await app.request("/health");
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("returns 503 when all providers are unhealthy", async () => {
    const app = createApp(
      createServices({
        whoop: {
          getAggregateHealth: async () => ({ status: "unhealthy" }),
        } as unknown as ExternalServices["whoop"],
        tonal: {
          getAggregateHealth: async () => ({ status: "unhealthy" }),
        } as unknown as ExternalServices["tonal"],
        alpaca: {
          checkHealth: async () => ({ status: "unhealthy" }),
        } as unknown as ExternalServices["alpaca"],
      }),
    );

    const response = await app.request("/health");
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });
});
