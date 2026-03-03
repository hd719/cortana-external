import { describe, expect, it } from "vitest";
import {
  deriveGatewayHealth,
  deriveHostHealth,
  deriveSessionHealth,
  formatAge,
  heartbeatStatusVariant,
  healthStatusVariant,
  summarizeSessions,
} from "@/lib/system-stats";

describe("system stats helpers", () => {
  it("derives host health from heartbeat and db signals", () => {
    expect(
      deriveHostHealth({ heartbeat: "healthy", postgres: true, lancedb: true })
    ).toBe("healthy");
    expect(
      deriveHostHealth({ heartbeat: "stale", postgres: true, lancedb: true })
    ).toBe("degraded");
    expect(
      deriveHostHealth({ heartbeat: "healthy", postgres: false, lancedb: true })
    ).toBe("critical");
  });

  it("derives gateway health from heartbeat and idle state", () => {
    expect(deriveGatewayHealth({ heartbeat: "healthy", idle: true })).toBe("idle");
    expect(deriveGatewayHealth({ heartbeat: "stale", idle: false })).toBe("degraded");
  });

  it("summarizes sessions and reports degraded health for stale/aborted", () => {
    const now = 1_700_000_000_000;
    const summary = summarizeSessions(
      [
        { updatedAt: now - 5 * 60 * 1000, abortedLastRun: null },
        { updatedAt: now - 3 * 60 * 60 * 1000, abortedLastRun: true },
        { updatedAt: null, abortedLastRun: false },
      ],
      now,
      30 * 60 * 1000,
      2 * 60 * 60 * 1000
    );

    expect(summary.active).toBe(3);
    expect(summary.recent).toBe(1);
    expect(summary.stale).toBe(2);
    expect(summary.aborted).toBe(1);
    expect(summary.lastUpdated).toBe(now - 5 * 60 * 1000);
    expect(deriveSessionHealth(summary)).toBe("degraded");
  });

  it("formats ages and status variants", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe("2h 5m ago");
    expect(healthStatusVariant("critical")).toBe("destructive");
    expect(heartbeatStatusVariant("quiet")).toBe("secondary");
  });
});
