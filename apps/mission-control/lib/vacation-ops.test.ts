import { describe, expect, it } from "vitest";
import {
  computeNextSummaryAt,
  deriveVacationPrepRepair,
  deriveVacationDisplayMode,
  formatVacationSystemLabel,
  formatVacationWindowLabel,
  sanitizeVacationDetail,
} from "@/lib/vacation-ops";

describe("vacation ops helpers", () => {
  it("formats system keys into readable labels", () => {
    expect(formatVacationSystemLabel("tailscale_remote_access")).toBe("Tailscale Remote Access");
    expect(formatVacationSystemLabel("green_baseline")).toBe("Green Baseline");
    expect(formatVacationSystemLabel("financial_external_services")).toBe("Schwab Market Data");
  });

  it("formats vacation window labels into operator dates", () => {
    expect(formatVacationWindowLabel("vacation-2026-04-13")).toBe("04-13-2026");
    expect(formatVacationWindowLabel("custom-label")).toBe("custom-label");
  });

  it("removes deleted trading providers from vacation readiness details", () => {
    expect(sanitizeVacationDetail("financial_external_services", {
      summary: "Alpaca, CoinMarketCap, and FRED are healthy or configured.",
      services: [
        { key: "alpaca", label: "Alpaca", status: "green" },
        { key: "coinmarketcap", label: "CoinMarketCap", status: "green" },
        { key: "fred", label: "FRED", status: "green" },
      ],
      marketDataOps: {
        status: "ok",
        providerMode: "schwab_primary",
        providerMetrics: {
          sourceUsage: {
            alpaca: 5,
            schwab: 10,
          },
        },
      },
    })).toEqual({
      summary: "Schwab market-data ops readiness checked.",
      services: [
        { key: "coinmarketcap", label: "CoinMarketCap", status: "green" },
      ],
      marketDataOps: {
        status: "ok",
        providerMode: "schwab_primary",
        providerMetrics: {
          sourceUsage: {
            schwab: 10,
          },
        },
      },
    });
  });

  it("treats completed windows as inactive display state", () => {
    expect(deriveVacationDisplayMode(null, { status: "completed" })).toBe("inactive");
    expect(deriveVacationDisplayMode(null, { status: "ready" })).toBe("ready");
    expect(deriveVacationDisplayMode({ status: "active" }, { status: "ready" })).toBe("active");
  });

  it("repairs prep windows after a completed green readiness run", () => {
    expect(deriveVacationPrepRepair(
      { id: 23, status: "prep" },
      {
        id: 60,
        vacationWindowId: 23,
        state: "completed",
        readinessOutcome: "pass",
        startedAt: "2026-04-30T17:43:34.146Z",
        completedAt: "2026-04-30T17:43:56.595Z",
      },
      new Date("2026-04-30T17:44:00.000Z"),
    )).toEqual({
      nextWindowStatus: "ready",
      cancelLatestRun: false,
      note: "Recovered staged vacation window from completed readiness run 60.",
      prepCompletedAt: "2026-04-30T17:43:56.595Z",
    });
  });

  it("fails stale prep windows with a stuck readiness run", () => {
    expect(deriveVacationPrepRepair(
      { id: 23, status: "prep" },
      {
        id: 58,
        vacationWindowId: 23,
        state: "running",
        readinessOutcome: null,
        startedAt: "2026-04-30T17:00:00.000Z",
        completedAt: null,
      },
      new Date("2026-04-30T17:20:01.000Z"),
    )).toEqual({
      nextWindowStatus: "failed",
      cancelLatestRun: true,
      note: "Cancelled stale readiness run 58 after staged preflight exceeded 15 minutes.",
      prepCompletedAt: "2026-04-30T17:20:01.000Z",
    });
  });

  it("computes the next summary time from the active window timezone", () => {
    const next = computeNextSummaryAt(
      { morning: "08:00", evening: "20:00" },
      {
        id: 1,
        label: "vacation-2026-04-13",
        status: "active",
        timezone: "America/New_York",
        startAt: "2026-04-13T12:00:00.000Z",
        endAt: "2026-04-20T12:00:00.000Z",
        prepRecommendedAt: null,
        prepStartedAt: null,
        prepCompletedAt: null,
        enabledAt: null,
        disabledAt: null,
        disableReason: null,
        triggerSource: "manual_command",
        createdBy: "hamel",
        configSnapshot: {},
        stateSnapshot: {},
        createdAt: "2026-04-12T12:00:00.000Z",
        updatedAt: "2026-04-12T12:00:00.000Z",
      },
      new Date("2026-04-12T14:00:00.000Z"),
    );

    expect(next).toBe("2026-04-13T00:00:00.000Z");
  });
});
