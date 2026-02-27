import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/council/[id]/members/route";
import { addCouncilMembers, getCouncilSessionById } from "@/lib/council";

vi.mock("@/lib/council", () => ({
  addCouncilMembers: vi.fn(),
  getCouncilSessionById: vi.fn(),
}));

describe("/api/council/[id]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST adds members and returns updated session", async () => {
    vi.mocked(addCouncilMembers).mockResolvedValueOnce();
    vi.mocked(getCouncilSessionById).mockResolvedValueOnce({ id: "c-1", members: [] } as never);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        members: [
          { agentId: "arbiter", role: "judge", weight: 2 },
          { agentId: "voter-a" },
        ],
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "c-1" }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(addCouncilMembers).toHaveBeenCalledWith("c-1", [
      { agentId: "arbiter", role: "judge", weight: 2, stance: null },
      { agentId: "voter-a", role: null, weight: 1, stance: null },
    ]);
  });
});
