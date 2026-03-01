import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskPrisma } from "@/lib/task-prisma";
import prisma from "@/lib/prisma";
import { upsertEpicFromSource, upsertTaskFromSource } from "@/lib/task-sync";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    cortanaTask: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/task-sync", () => ({
  upsertEpicFromSource: vi.fn(),
  upsertTaskFromSource: vi.fn(),
}));

const makePreferredClient = () => ({
  cortanaTask: { findMany: vi.fn() },
  cortanaEpic: { findMany: vi.fn() },
});

let now = new Date("2026-02-27T12:00:00.000Z").valueOf();

describe("lib/task-reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    now += 1000 * 60 * 20;
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconciles drift by upserting preferred items and deleting non-preferred IDs", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    preferred.cortanaEpic.findMany.mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);

    const tx = {
      cortanaTask: {
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 2 }),
      },
      cortanaEpic: {
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report?.drift).toBe(true);
    expect(tx.cortanaTask.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: [1, 2] } } });
    expect(tx.cortanaEpic.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: [10] } } });
    expect(vi.mocked(upsertTaskFromSource)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertEpicFromSource)).toHaveBeenCalledTimes(1);
    expect(report?.reconciled?.removedTaskCount).toBe(2);
    expect(report?.reconciled?.removedEpicCount).toBe(1);
  });

  it("does not reconcile when there is no drift", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report?.drift).toBe(false);
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
    expect(vi.mocked(upsertTaskFromSource)).not.toHaveBeenCalled();
    expect(vi.mocked(upsertEpicFromSource)).not.toHaveBeenCalled();
  });

  it("returns cached report when called again within interval", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }]);
    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([{ id: 1 }]);

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const first = await reconcileTaskBoardSources();

    const second = await reconcileTaskBoardSources();
    expect(second).toEqual(first);

    expect(preferred.cortanaTask.findMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.cortanaTask.findMany)).toHaveBeenCalledTimes(1);
  });

  it("returns null when preferred task client is unavailable", async () => {
    vi.mocked(getTaskPrisma).mockReturnValue(null as never);

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report).toBeNull();
    expect(vi.mocked(prisma.cortanaTask.findMany)).not.toHaveBeenCalled();
  });
});
