import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/feedback/metrics/route";
import { getFeedbackMetrics } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({
  getFeedbackMetrics: vi.fn(),
}));

describe("GET /api/feedback/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns metrics with counts and trends", async () => {
    vi.mocked(getFeedbackMetrics).mockResolvedValueOnce({
      bySeverity: { low: 1, high: 2 },
      byStatus: { new: 2, verified: 1 },
      byRemediationStatus: { open: 2, resolved: 1 },
      byCategory: { ux: 2, reliability: 1 },
      dailyCorrections: [{ day: "2026-02-26", count: 3 }],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      bySeverity: { low: 1, high: 2 },
      byStatus: { new: 2, verified: 1 },
      byRemediationStatus: { open: 2, resolved: 1 },
      byCategory: { ux: 2, reliability: 1 },
      dailyCorrections: [{ day: "2026-02-26", count: 3 }],
    });
  });
});
