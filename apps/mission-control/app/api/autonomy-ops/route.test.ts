import { beforeEach, describe, expect, it, vi } from "vitest";

const getAutonomyOpsSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/autonomy-ops", () => ({ getAutonomyOpsSnapshot }));

describe("GET /api/autonomy-ops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached autonomy artifact data", async () => {
    getAutonomyOpsSnapshot.mockReturnValue({ ok: true, stale: false, artifactPath: "/tmp/latest.json", data: { operatorState: "live" } });
    const { GET } = await import("@/app/api/autonomy-ops/route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { operatorState: "live" } });
  });

  it("returns 503 when the artifact is unavailable", async () => {
    getAutonomyOpsSnapshot.mockReturnValue({ ok: false, stale: true, artifactPath: "/tmp/latest.json", error: "missing" });
    const { GET } = await import("@/app/api/autonomy-ops/route");
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
