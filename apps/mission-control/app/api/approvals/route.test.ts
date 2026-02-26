import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/approvals/route";
import { getApprovals } from "@/lib/approvals";

vi.mock("@/lib/approvals", () => ({
  getApprovals: vi.fn(),
}));

describe("GET /api/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns approvals list with filters from searchParams", async () => {
    vi.mocked(getApprovals).mockResolvedValueOnce([
      { id: "apr-1", status: "pending" },
    ] as never);

    const request = new Request(
      "http://localhost/api/approvals?status=pending&risk_level=p1&rangeHours=48&limit=5",
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ approvals: [{ id: "apr-1", status: "pending" }] });
    expect(getApprovals).toHaveBeenCalledWith({
      status: "pending",
      risk_level: "p1",
      rangeHours: 48,
      limit: 5,
    });
  });

  it("returns empty array when no approvals exist", async () => {
    vi.mocked(getApprovals).mockResolvedValueOnce([] as never);

    const response = await GET(new Request("http://localhost/api/approvals"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ approvals: [] });
  });
});
