import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/feedback/[id]/route";
import { getFeedbackById, updateFeedbackRemediation } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({
  REMEDIATION_STATUSES: ["open", "in_progress", "resolved", "wont_fix"],
  getFeedbackById: vi.fn(),
  updateFeedbackRemediation: vi.fn(),
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

  it("PATCH updates remediation status and notes", async () => {
    vi.mocked(updateFeedbackRemediation).mockResolvedValueOnce(true);
    vi.mocked(getFeedbackById).mockResolvedValueOnce({ id: "fb-1", remediationStatus: "resolved" } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ remediationStatus: "resolved", remediationNotes: "Fixed in #123", resolvedBy: "hamel" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "fb-1" }) });
    const body = await response.json();

    expect(updateFeedbackRemediation).toHaveBeenCalledWith("fb-1", "resolved", "Fixed in #123", "hamel");
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, item: { id: "fb-1", remediationStatus: "resolved" } });
  });

  it("PATCH validates remediation status", async () => {
    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ remediationStatus: "bad_status" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "fb-1" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid remediationStatus");
    expect(updateFeedbackRemediation).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when feedback item does not exist", async () => {
    vi.mocked(updateFeedbackRemediation).mockResolvedValueOnce(false);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ remediationStatus: "in_progress" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "missing" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Feedback item not found");
  });
});
