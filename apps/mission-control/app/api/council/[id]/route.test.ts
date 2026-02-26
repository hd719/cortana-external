import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/council/[id]/route";
import { finalizeDecision, getCouncilSessionById, submitVote } from "@/lib/council";

vi.mock("@/lib/council", () => ({
  getCouncilSessionById: vi.fn(),
  finalizeDecision: vi.fn(),
  submitVote: vi.fn(),
}));

describe("/api/council/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns single session", async () => {
    vi.mocked(getCouncilSessionById).mockResolvedValueOnce({ id: "c-1", topic: "Deploy" } as never);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "c-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "c-1", topic: "Deploy" });
  });

  it("PATCH finalize updates and returns session", async () => {
    vi.mocked(finalizeDecision).mockResolvedValueOnce();
    vi.mocked(getCouncilSessionById).mockResolvedValueOnce({ id: "c-1", status: "decided" } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({
        action: "finalize",
        decision: { outcome: "approve" },
        confidence: 0.94,
        rationale: "Majority agreed",
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "c-1" }) });
    const body = await response.json();

    expect(finalizeDecision).toHaveBeenCalledWith("c-1", { outcome: "approve" }, 0.94, "Majority agreed");
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("PATCH vote updates and returns session", async () => {
    vi.mocked(submitVote).mockResolvedValueOnce();
    vi.mocked(getCouncilSessionById).mockResolvedValueOnce({ id: "c-1", status: "running" } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({
        action: "vote",
        memberId: 7,
        vote: "approve",
        reasoning: "Looks safe",
        voteScore: 0.82,
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "c-1" }) });
    const body = await response.json();

    expect(submitVote).toHaveBeenCalledWith("c-1", 7, "approve", "Looks safe", 0.82);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
