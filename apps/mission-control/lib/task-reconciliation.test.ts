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
    cortanaEpic: { findMany: vi.fn() },
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
    now += 1000 * 60 * 20;
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TASK_RECONCILE_QUARANTINE_HOURS;
  });

  it("quarantines missing items and only deletes by quarantine age", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    preferred.cortanaEpic.findMany.mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
    vi.mocked(prisma.cortanaEpic.findMany).mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    const tx = {
      cortanaTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 2 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
      },
      cortanaEpic: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report?.drift).toBe(true);
    expect(tx.cortanaTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quarantinedAt: null } })
    );
    expect(tx.cortanaTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quarantinedAt: expect.any(Date) } })
    );
    expect(tx.cortanaTask.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quarantinedAt: { lt: expect.any(Date) } } })
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(vi.mocked(upsertTaskFromSource)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertEpicFromSource)).toHaveBeenCalledTimes(1);
  });

  it("unquarantines items when they reappear even without drift", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    preferred.cortanaEpic.findMany.mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    const tx = {
      cortanaTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
      },
      cortanaEpic: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx));

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report?.drift).toBe(false);
    expect(tx.cortanaTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quarantinedAt: null } })
    );
    expect(vi.mocked(upsertTaskFromSource)).not.toHaveBeenCalled();
    expect(vi.mocked(upsertEpicFromSource)).not.toHaveBeenCalled();
  });

  it("purges items quarantined longer than threshold", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    process.env.TASK_RECONCILE_QUARANTINE_HOURS = "24";

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }]);
    preferred.cortanaEpic.findMany.mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([{ id: 1 }]);

    const tx = {
      cortanaTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 2 }),
      },
      cortanaEpic: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx));

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(tx.cortanaTask.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quarantinedAt: { lt: expect.any(Date) } } })
    );
    expect(tx.cortanaEpic.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quarantinedAt: { lt: expect.any(Date) } } })
    );
    expect(report?.reconciled?.removedTaskCount).toBe(2);
    expect(report?.reconciled?.removedEpicCount).toBe(1);
  });

  it("aborts reconciliation when quarantine exceeds 50%", async () => {
    const preferred = makePreferredClient();
    vi.mocked(getTaskPrisma).mockReturnValue(preferred as never);

    preferred.cortanaTask.findMany.mockResolvedValueOnce([{ id: 1 }]);
    preferred.cortanaEpic.findMany.mockResolvedValueOnce([]);

    vi.mocked(prisma.cortanaTask.findMany).mockResolvedValueOnce([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
    vi.mocked(prisma.cortanaEpic.findMany).mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { reconcileTaskBoardSources } = await import("@/lib/task-reconciliation");
    const report = await reconcileTaskBoardSources();

    expect(report?.drift).toBe(true);
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
