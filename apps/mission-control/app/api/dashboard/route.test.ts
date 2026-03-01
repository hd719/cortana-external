import { describe, expect, it, vi } from "vitest";
import { getDashboardSummary } from "@/lib/data";

vi.mock("@/lib/data", () => ({
  getDashboardSummary: vi.fn(),
}));

describe("GET /api/dashboard", () => {
  it("bubbles dashboard summary failures", async () => {
    vi.mocked(getDashboardSummary).mockRejectedValueOnce(new Error("db down"));

    const { GET } = await import("@/app/api/dashboard/route");
    await expect(GET()).rejects.toThrow("db down");
  });
});
