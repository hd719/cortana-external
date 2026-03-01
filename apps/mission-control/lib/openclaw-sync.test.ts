import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("node:fs", () => ({
  promises: {
    stat: statMock,
    readFile: readFileMock,
  },
  default: {
    promises: {
      stat: statMock,
      readFile: readFileMock,
    },
  },
}));

const ingestMock = vi.fn();
const backfillMock = vi.fn();
vi.mock("@/lib/openclaw-bridge", () => ({
  ingestOpenClawLifecycleEvent: ingestMock,
  backfillOpenClawRunAssignments: backfillMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    run: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    event: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("lib/openclaw-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENCLAW_SUBAGENT_RUNS_PATH = "/tmp/openclaw-runs.json";
  });

  afterEach(() => {
    delete process.env.OPENCLAW_SUBAGENT_RUNS_PATH;
  });

  it("normalizes done/ok to completed when syncing store runs", async () => {
    const prisma = (await import("@/lib/prisma")).default;
    vi.mocked(prisma.run.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    backfillMock.mockResolvedValue({ scanned: 0, updated: 0 });

    statMock.mockResolvedValue({ mtimeMs: 1000 });
    readFileMock.mockResolvedValue(
      JSON.stringify({
        runs: {
          a: { runId: "run-a", endedAt: 1700000000000, outcome: { status: "done" } },
          b: { runId: "run-b", endedAt: 1700000000001, outcome: { status: "ok" } },
        },
      })
    );

    const { syncOpenClawRunsFromStore } = await import("@/lib/openclaw-sync");
    await syncOpenClawRunsFromStore();

    const statuses = ingestMock.mock.calls.map((call) => call[0]?.status);
    expect(statuses).toEqual(["completed", "completed"]);
  });

  it("marks stale runs as failed with externalStatus failed", async () => {
    const prisma = (await import("@/lib/prisma")).default;

    vi.mocked(prisma.run.findMany).mockResolvedValue([
      { id: "1", openclawRunId: "stale-1", summary: null },
    ] as never);

    vi.mocked(prisma.run.update).mockReturnValue("run-update" as never);
    vi.mocked(prisma.event.create).mockReturnValue("event-create" as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    backfillMock.mockResolvedValue({ scanned: 0, updated: 0 });

    statMock.mockResolvedValue({ mtimeMs: 2000 });
    readFileMock.mockResolvedValue(JSON.stringify({ runs: {} }));

    const { syncOpenClawRunsFromStore } = await import("@/lib/openclaw-sync");
    const result = await syncOpenClawRunsFromStore();

    expect(result.reconciled).toBe(1);
    expect(prisma.run.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          externalStatus: "failed",
        }),
      })
    );
  });
});
