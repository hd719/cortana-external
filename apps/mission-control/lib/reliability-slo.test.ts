import { describe, expect, it } from "vitest";
import { computeReliabilitySloMetrics } from "@/lib/reliability-slo";

describe("computeReliabilitySloMetrics", () => {
  it("aggregates cron, delivery, abort, p95, and provider 429 rates", () => {
    const now = Date.parse("2026-03-03T17:00:00.000Z");

    const jobs = [
      {
        enabled: true,
        schedule: { kind: "every", everyMs: 60000 },
        state: { nextRunAtMs: now + 10_000, consecutiveErrors: 0, lastStatus: "ok" },
        delivery: { mode: "none" },
      },
      {
        enabled: true,
        schedule: { kind: "every", everyMs: 60000 },
        state: { nextRunAtMs: now - 10_000, consecutiveErrors: 0, lastStatus: "ok" },
        delivery: { mode: "announce", to: "telegram" },
      },
      {
        enabled: true,
        schedule: { kind: "every", everyMs: 60000 },
        state: {
          nextRunAtMs: now + 10_000,
          consecutiveErrors: 0,
          lastStatus: "ok",
          lastDelivered: true,
          lastDeliveryStatus: "delivered",
        },
        delivery: { mode: "announce", to: "telegram" },
      },
    ];

    const runs = [
      {
        status: "completed",
        externalStatus: "done",
        startedAt: new Date(now - 20_000),
        completedAt: new Date(now - 10_000),
        payload: { provider: "openai", outcome: { status: "ok" } },
        summary: "ok",
      },
      {
        status: "failed",
        externalStatus: "killed",
        startedAt: new Date(now - 40_000),
        completedAt: new Date(now - 25_000),
        payload: { provider: "openai", endedReason: "aborted", outcome: { status: "error" } },
        summary: "aborted",
      },
      {
        status: "failed",
        externalStatus: "failed",
        startedAt: new Date(now - 60_000),
        completedAt: new Date(now - 55_000),
        payload: { provider: "anthropic", outcome: { statusCode: 429 } },
        summary: "429 rate limit",
      },
    ];

    const metrics = computeReliabilitySloMetrics({ jobs, runs, nowMs: now });

    expect(metrics.cronOnTimePct).toBe(66.7);
    expect(metrics.abortedRunRatePct).toBe(33.3);
    expect(metrics.deliverySuccessPct).toBe(50);
    expect(metrics.p95ResponseMs).toBe(15000);

    expect(metrics.api429RateByProvider[0]).toMatchObject({
      provider: "anthropic",
      count429: 1,
      total: 1,
      ratePct: 100,
    });
    expect(metrics.api429RateByProvider[1]).toMatchObject({
      provider: "openai",
      count429: 0,
      total: 2,
      ratePct: 0,
    });
  });
});
