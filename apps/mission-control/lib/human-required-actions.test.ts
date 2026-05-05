import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { execFileSync },
  execFileSync,
}));

describe("human-required action reader", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileSync.mockReset();
  });

  it("maps open queue rows into display-safe items", async () => {
    execFileSync.mockReturnValue(JSON.stringify([{
      id: 7,
      system: "browser_session",
      category: "human_browser",
      severity: "warning",
      status: "open",
      summary: "Browser login required",
      required_action: "Open Chrome and sign in.",
      last_seen_at: "2026-05-05T12:00:00Z",
      due_at: null,
      verification_key: "browser_cdp_health",
      alert_count: 1,
      detection_count: 2,
    }]));

    const { listHumanRequiredActions } = await import("@/lib/human-required-actions");
    expect(listHumanRequiredActions()).toEqual([expect.objectContaining({
      id: 7,
      system: "browser_session",
      requiredAction: "Open Chrome and sign in.",
      verificationKey: "browser_cdp_health",
    })]);
  });
});
