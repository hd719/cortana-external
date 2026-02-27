import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/feedback/route";
import { createFeedback, getFeedbackItems } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({
  getFeedbackItems: vi.fn(),
  createFeedback: vi.fn(),
}));

describe("/api/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns feedback list", async () => {
    vi.mocked(getFeedbackItems).mockResolvedValueOnce([{ id: "fb-1", summary: "a" }] as never);

    const req = new Request("http://localhost/api/feedback?status=new&severity=high&source=user&rangeHours=12&limit=10");
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [{ id: "fb-1", summary: "a" }] });
    expect(getFeedbackItems).toHaveBeenCalledWith({
      status: "new",
      remediationStatus: "all",
      severity: "high",
      category: undefined,
      source: "user",
      rangeHours: 12,
      limit: 10,
    });
  });

  it("POST creates new feedback item", async () => {
    vi.mocked(createFeedback).mockResolvedValueOnce("fb-new");

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        source: "user",
        category: "ux",
        severity: "medium",
        summary: "text",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createFeedback).toHaveBeenCalledWith({
      source: "user",
      category: "ux",
      severity: "medium",
      summary: "text",
    });
    expect(body).toEqual({ ok: true, id: "fb-new" });
  });
});
