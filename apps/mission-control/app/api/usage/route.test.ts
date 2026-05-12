import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/usage/route";
import { getUsageAnalytics } from "@/lib/usage-analytics";

vi.mock("@/lib/usage-analytics", () => ({
  getUsageAnalytics: vi.fn(),
}));

describe("GET /api/usage", () => {
  it("returns usage payload", async () => {
    vi.mocked(getUsageAnalytics).mockResolvedValueOnce({
      windowMinutes: 60,
      totals: { sessions: 2, totalTokens: 300, inputTokens: 100, outputTokens: 200, estimatedCost: 0.0042 },
      byModel: [{ model: "gpt-5.3-codex", sessions: 2, totalTokens: 300, inputTokens: 100, outputTokens: 200, estimatedCost: 0.0042 }],
      byAgent: [{ agentId: "monitor", model: "n/a", sessions: 2, totalTokens: 300, inputTokens: 100, outputTokens: 200, estimatedCost: 0.0042 }],
      sessions: [],
    });

    const response = await GET(new Request("http://localhost/api/usage?minutes=60"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getUsageAnalytics).toHaveBeenCalledWith("60");
    expect(body.windowMinutes).toBe(60);
    expect(body.totals.estimatedCost).toBe(0.0042);
  });

  it("returns 500 on upstream error", async () => {
    vi.mocked(getUsageAnalytics).mockRejectedValueOnce(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/usage"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("boom");
  });
});
