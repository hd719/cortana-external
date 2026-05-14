import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCortanaPrisma } from "@/lib/cortana-prisma";
import prisma from "@/lib/prisma";
import { getLogEntries } from "@/lib/logs";

vi.mock("@/lib/cortana-prisma", () => ({
  getCortanaPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
  },
}));

describe("lib/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCortanaPrisma).mockReturnValue(null);
  });

  it("returns log entries with filters", async () => {
    const timestamp = new Date("2026-03-02T12:00:00.000Z");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 1,
        timestamp,
        event_type: "deploy_failure",
        source: "core",
        severity: "error",
        message: "Deploy failed",
        metadata: { build: "123" },
      },
    ]);

    const result = await getLogEntries({
      rangeHours: 12,
      limit: 20,
      severity: "error",
      source: "core",
      query: "Deploy",
    });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({ eventType: "deploy_failure", source: "core", severity: "error" });

    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INTERVAL '12 hours'");
    expect(query).toContain("lower(severity)");
    expect(query).toContain("source = 'core'");
    expect(query).toContain("ILIKE '%Deploy%'");
    expect(query).toContain("LIMIT 20");
  });

  it("supports the synthetic alerts severity filter", async () => {
    const timestamp = new Date("2026-04-23T09:58:30.510Z");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 77,
        timestamp,
        event_type: "subagent.reconciled_stale",
        source: "openclaw-sync",
        severity: "warning",
        message: "Stale sub-agent state auto-reconciled",
        metadata: {},
      },
    ]);

    const result = await getLogEntries({
      rangeHours: 24,
      limit: 10,
      severity: "alerts",
    });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({ severity: "warning" });

    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("lower(coalesce(severity, '')) IN ('warning', 'critical')");
    expect(query).not.toContain("lower(severity) = 'alerts'");
  });
});
