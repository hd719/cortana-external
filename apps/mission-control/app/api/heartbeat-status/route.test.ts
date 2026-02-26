import { describe, expect, it } from "vitest";
import { normalizeTimestamp, getStatus } from "@/app/api/heartbeat-status/route";

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
