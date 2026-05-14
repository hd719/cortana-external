import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VacationOpsBanner } from "@/components/vacation-ops-banner";

const jsonResponse = (payload: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

const baseSnapshot = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: new Date().toISOString(),
  mode: "inactive",
  config: {
    timezone: "America/New_York",
    summaryTimes: { morning: "08:00", evening: "20:00" },
    pausedJobIds: [],
    remediationLadder: [],
    systemCount: 0,
    systemKeys: [],
    tierCounts: {},
  },
  recommendation: { timezone: "", recommendedPrepAt: "", startAt: "", endAt: "", reason: "" },
  latestWindow: null,
  activeWindow: null,
  latestReadiness: null,
  latestSummary: null,
  mirror: null,
  nextSummaryAt: null,
  latestChecks: [],
  recentIncidents: [],
  recentActions: [],
  tierRollup: [],
  counts: {
    activeIncidents: 0,
    humanRequiredIncidents: 0,
    resolvedIncidents: 0,
    pausedJobs: 0,
    selfHeals: 0,
  },
  enableReadyWindowId: null,
  pausedJobs: [],
  ...overrides,
});

describe("VacationOpsBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one-line banner with mode + readiness when no incidents", async () => {
    const snap = baseSnapshot({
      mode: "inactive",
      latestReadiness: { readinessOutcome: "no_go", completedAt: new Date(Date.now() - 7200_000).toISOString(), startedAt: null },
    });
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ status: "ok", data: snap }));

    render(<VacationOpsBanner />);

    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
    expect(screen.getByText("INACTIVE")).toBeInTheDocument();
    // Banner is collapsed: VacationOpsCard's title should NOT render.
    expect(screen.queryByText("Away-mode readiness")).toBeNull();
  });

  it("surfaces the first active incident inline when incidents > 0 (no auto-expand)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        status: "ok",
        data: baseSnapshot({
          mode: "inactive",
          counts: {
            activeIncidents: 2,
            humanRequiredIncidents: 1,
            resolvedIncidents: 0,
            pausedJobs: 0,
            selfHeals: 0,
          },
          recentIncidents: [
            {
              id: 1,
              vacationWindowId: 1,
              runId: null,
              latestCheckResultId: null,
              latestActionId: null,
              systemKey: "schwab",
              systemLabel: "Schwab",
              tier: 1,
              status: "active",
              humanRequired: true,
              firstObservedAt: new Date().toISOString(),
              lastObservedAt: new Date().toISOString(),
              resolvedAt: null,
              resolutionReason: null,
              symptom: "auth token expired",
              detail: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      }),
    );

    render(<VacationOpsBanner />);

    expect(await screen.findByText(/2 incidents/)).toBeInTheDocument();
    expect(screen.getByText(/Schwab.*auth token expired/)).toBeInTheDocument();
    // Banner stays collapsed — the full VacationOpsCard should NOT auto-render.
    expect(screen.queryByText("Away-mode readiness")).toBeNull();
  });

  it("toggles expansion on click", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ status: "ok", data: baseSnapshot() }),
    );

    render(<VacationOpsBanner />);

    await waitFor(() => expect(screen.getByText("INACTIVE")).toBeInTheDocument());

    // Click the banner button → expands.
    fireEvent.click(screen.getByText("INACTIVE"));
    await waitFor(() => expect(screen.getByText("Away-mode readiness")).toBeInTheDocument());

    // Click the collapse affordance → collapses back to banner.
    fireEvent.click(screen.getByText("Collapse vacation ops"));
    await waitFor(() => expect(screen.getByText("INACTIVE")).toBeInTheDocument());
    expect(screen.queryByText("Away-mode readiness")).toBeNull();
  });
});
