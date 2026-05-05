import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshAutonomyOpsArtifact = vi.hoisted(() => vi.fn());
const getAutonomyOpsSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/autonomy-ops", () => ({ refreshAutonomyOpsArtifact, getAutonomyOpsSnapshot }));

describe("POST /api/autonomy-ops/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the autonomy artifact", async () => {
    refreshAutonomyOpsArtifact.mockResolvedValue({ ok: true, stale: false, artifactPath: "/tmp/latest.json", data: { operatorState: "watch" } });
    const { POST } = await import("@/app/api/autonomy-ops/refresh/route");
    const response = await POST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { operatorState: "watch" } });
  });

  it("returns stale snapshot detail when refresh fails", async () => {
    refreshAutonomyOpsArtifact.mockRejectedValue(new Error("writer failed"));
    getAutonomyOpsSnapshot.mockReturnValue({ ok: false, stale: true, artifactPath: "/tmp/latest.json", error: "missing" });
    const { POST } = await import("@/app/api/autonomy-ops/refresh/route");
    const response = await POST();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "writer failed", staleData: { error: "missing" } });
  });
});
