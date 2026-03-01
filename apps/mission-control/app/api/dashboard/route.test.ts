import { describe, expect, it, vi } from "vitest";
import { getDashboardSummary } from "@/lib/data";

vi.mock("@/lib/data", () => ({
  getDashboardSummary: vi.fn(),
}));

describe("GET /api/dashboard", () => {
  it("returns 503 when dashboard summary fails", async () => {
    vi.mocked(getDashboardSummary).mockRejectedValueOnce(new Error("db down"));

    const { GET } = await import("@/app/api/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
  });
});
