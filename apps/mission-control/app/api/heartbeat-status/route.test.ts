import { describe, expect, it } from "vitest";
import { normalizeTimestamp, getStatus, resolveLatestHeartbeat } from "@/app/api/heartbeat-status/route";

describe("normalizeTimestamp", () => {
  it("converts seconds timestamps to milliseconds", () => {
    expect(normalizeTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("keeps millisecond timestamps as-is", () => {
    expect(normalizeTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("returns null for invalid values", () => {
    expect(normalizeTimestamp("1700000000")).toBeNull();
    expect(normalizeTimestamp(Number.NaN)).toBeNull();
    expect(normalizeTimestamp(null)).toBeNull();
  });
});

describe("resolveLatestHeartbeat", () => {
  it("prefers newer lastChecks timestamp over stale lastHeartbeat", () => {
    const stale = 1_700_000_000_000;
    const fresh = 1_700_000_360_000;
    expect(
      resolveLatestHeartbeat({
        lastHeartbeat: stale,
        lastChecks: {
          cron_delivery: { lastChecked: stale / 1000 },
          subagent_watchdog: { lastChecked: fresh / 1000 },
        },
      })
    ).toBe(fresh);
  });
});

describe("getStatus", () => {
  it("returns healthy when younger than 90 minutes", () => {
    expect(getStatus(89 * 60 * 1000)).toBe("healthy");
  });

  it("returns stale between 90 minutes and 3 hours inclusive", () => {
    expect(getStatus(90 * 60 * 1000)).toBe("stale");
    expect(getStatus(3 * 60 * 60 * 1000)).toBe("stale");
  });

  it("returns missed after 3 hours", () => {
    expect(getStatus(3 * 60 * 60 * 1000 + 1)).toBe("missed");
  });

  it("returns unknown for null age", () => {
    expect(getStatus(null)).toBe("unknown");
  });
});
