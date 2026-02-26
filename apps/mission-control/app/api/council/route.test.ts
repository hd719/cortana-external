import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/council/route";
import { createCouncilSession, getCouncilSessions } from "@/lib/council";

vi.mock("@/lib/council", () => ({
  getCouncilSessions: vi.fn(),
  createCouncilSession: vi.fn(),
}));

describe("/api/council", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns sessions with parsed filters", async () => {
    vi.mocked(getCouncilSessions).mockResolvedValueOnce([{ id: "c-1", topic: "Deploy" }] as never);

    const request = new Request("http://localhost/api/council?status=running&mode=majority&rangeHours=48&limit=25");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sessions: [{ id: "c-1", topic: "Deploy" }] });
    expect(getCouncilSessions).toHaveBeenCalledWith({
      status: "running",
      mode: "majority",
      rangeHours: 48,
      limit: 25,
    });
  });

  it("POST creates council session", async () => {
    vi.mocked(createCouncilSession).mockResolvedValueOnce({ id: "c-2", topic: "Plan" } as never);

    const request = new Request("http://localhost/api/council", {
      method: "POST",
      body: JSON.stringify({ topic: "Plan", mode: "weighted", objective: "Choose path" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ session: { id: "c-2", topic: "Plan" } });
    expect(createCouncilSession).toHaveBeenCalledWith({
      taskId: undefined,
      topic: "Plan",
      objective: "Choose path",
      mode: "weighted",
      createdBy: undefined,
    });
  });
});
