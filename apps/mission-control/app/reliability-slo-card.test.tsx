import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReliabilitySloCard } from "@/components/reliability-slo-card";

const jsonResponse = (payload: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

describe("ReliabilitySloCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders five SLO metrics and provider rows", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      jsonResponse({
        generatedAt: "2026-03-03T17:00:00.000Z",
        windowHours: 24,
        metrics: {
          cronOnTimePct: 98.5,
          abortedRunRatePct: 2.1,
          deliverySuccessPct: 96,
          p95ResponseMs: 1820,
          api429RateByProvider: [
            { provider: "openai", ratePct: 1.2, total: 80, count429: 1 },
            { provider: "anthropic", ratePct: 0, total: 33, count429: 0 },
          ],
          samples: {
            cronJobs: 40,
            terminalRuns: 120,
            deliveryRequiredJobs: 25,
            responseSamples: 120,
            providerSamples: 2,
          },
        },
      })
    );

    render(<ReliabilitySloCard />);

    expect(await screen.findByText("Reliability SLOs")).toBeInTheDocument();
    expect(screen.getByText("Cron on-time")).toBeInTheDocument();
    expect(screen.getByText("Aborted run rate")).toBeInTheDocument();
    expect(screen.getByText("Delivery success")).toBeInTheDocument();
    expect(screen.getByText("P95 response")).toBeInTheDocument();
    expect(screen.getByText("API 429 rate")).toBeInTheDocument();
    expect(screen.getAllByText("openai").length).toBeGreaterThan(0);
    expect(screen.getByText("anthropic")).toBeInTheDocument();
  });
});
