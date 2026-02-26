import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/feedback/[id]/route";
import { getFeedbackById, updateFeedbackStatus } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({
  getFeedbackById: vi.fn(),
  updateFeedbackStatus: vi.fn(),
}));

describe("/api/feedback/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns single feedback with actions", async () => {
    vi.mocked(getFeedbackById).mockResolvedValueOnce({
      id: "fb-1",
      actions: [{ id: 1, actionType: "opened_pr" }],
    } as never);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "fb-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("fb-1");
    expect(body.actions).toHaveLength(1);
  });

  it("PATCH updates status", async () => {
    vi.mocked(updateFeedbackStatus).mockResolvedValueOnce();
    vi.mocked(getFeedbackById).mockResolvedValueOnce({ id: "fb-1", status: "verified" } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "verified", owner: "hamel" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "fb-1" }) });
    const body = await response.json();

    expect(updateFeedbackStatus).toHaveBeenCalledWith("fb-1", "verified", "hamel");
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, item: { id: "fb-1", status: "verified" } });
  });
});
