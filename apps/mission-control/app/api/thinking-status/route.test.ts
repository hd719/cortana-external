import { describe, expect, it } from "vitest";
import { normalizeTimestamp, resolveLatestHeartbeat } from "@/app/api/thinking-status/route";

describe("thinking-status heartbeat timestamp resolution", () => {
  it("normalizes seconds timestamps", () => {
    expect(normalizeTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("uses freshest heartbeat signal across lastHeartbeat and lastChecks", () => {
    const stale = 1_700_000_000_000;
    const fresh = 1_700_000_600_000;

    expect(
      resolveLatestHeartbeat({
        lastHeartbeat: stale,
        lastChecks: {
          heartbeat_state: { lastChecked: stale / 1000 },
          cron_delivery: { lastChecked: fresh / 1000 },
        },
      })
    ).toBe(fresh);
  });
});
