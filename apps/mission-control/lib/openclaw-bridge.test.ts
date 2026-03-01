import { RunStatus } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    agent: { findMany: vi.fn() },
    run: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    event: { create: vi.fn() },
    cortanaTask: { updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/openclaw-assignment", () => ({
  resolveAssignedAgentId: vi.fn(() => ({ agentId: "agent-1" })),
}));

vi.mock("@/lib/run-intelligence", () => ({
  deriveEvidenceGrade: vi.fn(() => "high"),
}));

describe("lib/openclaw-bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizeLifecycleStatus maps completion aliases and keeps known statuses", async () => {
    const { normalizeLifecycleStatus } = await import("@/lib/openclaw-bridge");

    expect(normalizeLifecycleStatus("done")).toBe("completed");
    expect(normalizeLifecycleStatus("complete")).toBe("completed");
    expect(normalizeLifecycleStatus("success")).toBe("completed");
    expect(normalizeLifecycleStatus("succeeded")).toBe("completed");
    expect(normalizeLifecycleStatus("ok")).toBe("completed");
    expect(normalizeLifecycleStatus("running")).toBe("running");
    expect(normalizeLifecycleStatus("failed")).toBe("failed");
  });

  it("normalizeLifecycleStatus returns null for unknown strings", async () => {
    const { normalizeLifecycleStatus } = await import("@/lib/openclaw-bridge");
    expect(normalizeLifecycleStatus("mystery-status")).toBeNull();
  });

  it("maps lifecycle completed to RunStatus.completed during ingest", async () => {
    const prisma = (await import("@/lib/prisma")).default;
    vi.mocked(prisma.agent.findMany).mockResolvedValue([{ id: "agent-1", name: "A", role: "ops" }]);
    vi.mocked(prisma.run.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.run.create).mockResolvedValue({ id: "run-1", agentId: "agent-1", payload: {}, summary: null });
    vi.mocked(prisma.event.create).mockResolvedValue({ id: "evt-1" } as never);

    const { ingestOpenClawLifecycleEvent } = await import("@/lib/openclaw-bridge");

    await ingestOpenClawLifecycleEvent({
      runId: "oc-1",
      status: "completed",
      summary: "done",
    });

    expect(prisma.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RunStatus.completed,
          externalStatus: "completed",
        }),
      })
    );
  });
});
