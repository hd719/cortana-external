import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { GET } from "@/app/api/sessions/route";

const makeRequest = (query = "") => new Request(`http://localhost/api/sessions${query}`);

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized sessions with default minutes", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(
      JSON.stringify({
        sessions: [
          {
            key: "agent:main:main",
            sessionId: "abc",
            updatedAt: 123,
            totalTokens: 100,
            inputTokens: 10,
            outputTokens: 90,
            model: "gpt-5.3-codex",
            agentId: "main",
            systemSent: true,
            abortedLastRun: false,
          },
        ],
      })
    );

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw sessions --json --all-agents --active 1440",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(response.status).toBe(200);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({
      key: "agent:main:main",
      sessionId: "abc",
      updatedAt: 123,
      totalTokens: 100,
      inputTokens: 10,
      outputTokens: 90,
      model: "gpt-5.3-codex",
      agentId: "main",
      systemSent: true,
      abortedLastRun: false,
    });
    expect(payload.sessions[0].estimatedCost).toBeCloseTo(0.00074, 6);
  });

  it("uses minutes param when provided", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(JSON.stringify({ sessions: [] }));

    const response = await GET(makeRequest("?minutes=60"));
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw sessions --json --all-agents --active 60",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(response.status).toBe(200);
    expect(payload.sessions).toEqual([]);
  });

  it("returns proper JSON shape", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(JSON.stringify({ sessions: [{ key: "a" }] }));

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(payload).toHaveProperty("sessions");
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.sessions[0]).toMatchObject({ key: "a" });
  });
});
