import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KpiRail } from "@/components/kpi-rail";

const jsonResponse = (payload: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

describe("KpiRail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all section headings even when every metric returns zero", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/today-stats")) {
        return jsonResponse({
          source: "app",
          generatedAt: new Date().toISOString(),
          metrics: {
            subagentsSpawnedToday: 0,
            runsCompletedToday: 0,
            selfHealsToday: 0,
            activeRunsNow: 0,
          },
        });
      }
      if (url.includes("/api/mjolnir")) {
        return jsonResponse({ status: "error", generatedAt: new Date().toISOString(), cached: false, error: { message: "no data" } });
      }
      if (url.includes("/api/reliability-slo")) {
        return jsonResponse({
          generatedAt: new Date().toISOString(),
          windowHours: 24,
          metrics: {
            cronOnTimePct: 0,
            abortedRunRatePct: 0,
            deliverySuccessPct: 0,
            p95ResponseMs: 0,
            api429RateByProvider: [],
            samples: { cronJobs: 0, terminalRuns: 0, deliveryRequiredJobs: 0, responseSamples: 0, providerSamples: 0 },
          },
        });
      }
      return jsonResponse({});
    });

    render(<KpiRail />);

    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Mjolnir")).toBeInTheDocument();
    expect(screen.getByText("Reliability · 24h")).toBeInTheDocument();
    expect(screen.getByText("Sub-agents")).toBeInTheDocument();
    expect(screen.getByText("Recovery")).toBeInTheDocument();
    expect(screen.getByText("Cron on-time")).toBeInTheDocument();
  });

  it("highlights non-zero today stats with the emerald tone class", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/today-stats")) {
        return jsonResponse({
          source: "app",
          generatedAt: new Date().toISOString(),
          metrics: {
            subagentsSpawnedToday: 3,
            runsCompletedToday: 0,
            selfHealsToday: 1,
            activeRunsNow: 0,
          },
        });
      }
      if (url.includes("/api/mjolnir")) {
        return jsonResponse({ status: "error", generatedAt: new Date().toISOString(), cached: false, error: { message: "no data" } });
      }
      if (url.includes("/api/reliability-slo")) {
        return jsonResponse({
          generatedAt: new Date().toISOString(),
          windowHours: 24,
          metrics: {
            cronOnTimePct: 0,
            abortedRunRatePct: 0,
            deliverySuccessPct: 0,
            p95ResponseMs: 0,
            api429RateByProvider: [],
            samples: { cronJobs: 0, terminalRuns: 0, deliveryRequiredJobs: 0, responseSamples: 0, providerSamples: 0 },
          },
        });
      }
      return jsonResponse({});
    });

    render(<KpiRail />);

    await waitFor(() => {
      const subagents = screen.getByText("3");
      expect(subagents.className).toMatch(/emerald/);
    });
  });
});
