import { beforeEach, describe, expect, it, vi } from "vitest";

const listHumanRequiredActions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/human-required-actions", () => ({ listHumanRequiredActions }));

describe("GET /api/human-required-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns open human-required actions", async () => {
    listHumanRequiredActions.mockReturnValue([{ id: 1, summary: "OAuth required" }]);
    const { GET } = await import("@/app/api/human-required-actions/route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, items: [{ id: 1 }] });
  });
});
