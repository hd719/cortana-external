import { describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const runFindManyMock = vi.fn();

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    default: {
      ...actual,
      readFile: (...args: unknown[]) => readFileMock(...args),
    },
    readFile: (...args: unknown[]) => readFileMock(...args),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    run: {
      findMany: (...args: unknown[]) => runFindManyMock(...args),
    },
  },
}));

describe("GET /api/reliability-slo", () => {
  it("returns aggregated reliability metrics", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        jobs: [
          {
            enabled: true,
            schedule: { kind: "every", everyMs: 60000 },
            state: { nextRunAtMs: Date.now() + 10_000, lastStatus: "ok", consecutiveErrors: 0 },
            delivery: { mode: "announce", to: "telegram" },
          },
        ],
      })
    );

    runFindManyMock.mockResolvedValueOnce([
      {
        status: "completed",
        externalStatus: "done",
        startedAt: new Date(Date.now() - 2000),
        completedAt: new Date(Date.now() - 500),
        payload: { provider: "openai" },
        summary: "ok",
      },
    ]);

    const { GET } = await import("@/app/api/reliability-slo/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.metrics).toBeDefined();
    expect(body.metrics.cronOnTimePct).toBeGreaterThanOrEqual(0);
    expect(body.metrics.p95ResponseMs).toBeGreaterThan(0);
  });
});
