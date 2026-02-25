import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";
import { upsertEpicFromSource, upsertTaskFromSource } from "@/lib/task-sync";

type ReconcileReport = {
  ranAt: string;
  drift: boolean;
  preferredCount: number;
  appCount: number;
  missingInAppSample: number[];
  missingInPreferredSample: number[];
  reconciled?: {
    syncedTaskCount: number;
    removedTaskCount: number;
    syncedEpicCount: number;
    removedEpicCount: number;
  };
};

const RECONCILE_INTERVAL_MS = 1000 * 60 * 15;

let lastRunAt = 0;
let cached: ReconcileReport | null = null;

export async function reconcileTaskBoardSources(): Promise<ReconcileReport | null> {
  const preferred = getTaskPrisma();
  if (!preferred) return null;

  const now = Date.now();
  if (cached && now - lastRunAt < RECONCILE_INTERVAL_MS) {
    return cached;
  }

  const [preferredIds, appIds] = await Promise.all([
    preferred.cortanaTask.findMany({ select: { id: true } }),
    prisma.cortanaTask.findMany({ select: { id: true } }),
  ]);

  const preferredSet = new Set(preferredIds.map((t) => t.id));
  const appSet = new Set(appIds.map((t) => t.id));

  const missingInApp = preferredIds.filter((t) => !appSet.has(t.id)).map((t) => t.id);
  const missingInPreferred = appIds.filter((t) => !preferredSet.has(t.id)).map((t) => t.id);
  const drift = missingInApp.length > 0 || missingInPreferred.length > 0;

  let reconciled: ReconcileReport["reconciled"];

  if (drift) {
    const [preferredEpics, preferredTasks] = await Promise.all([
      preferred.cortanaEpic.findMany({ select: { id: true } }),
      preferred.cortanaTask.findMany({ select: { id: true } }),
    ]);

    const preferredEpicIds = preferredEpics.map((epic) => epic.id);
    const preferredTaskIds = preferredTasks.map((task) => task.id);

    await prisma.$transaction(async (tx) => {
      for (const epic of preferredEpics) {
        await upsertEpicFromSource(preferred, epic.id);
      }

      for (const task of preferredTasks) {
        await upsertTaskFromSource(preferred, task.id);
      }

      const removedTasks = await tx.cortanaTask.deleteMany({
        where: { id: { notIn: preferredTaskIds } },
      });

      const removedEpics = await tx.cortanaEpic.deleteMany({
        where: { id: { notIn: preferredEpicIds } },
      });

      reconciled = {
        syncedTaskCount: preferredTasks.length,
        removedTaskCount: removedTasks.count,
        syncedEpicCount: preferredEpics.length,
        removedEpicCount: removedEpics.count,
      };
    });
  }

  cached = {
    ranAt: new Date(now).toISOString(),
    drift,
    preferredCount: preferredIds.length,
    appCount: appIds.length,
    missingInAppSample: missingInApp.slice(0, 10),
    missingInPreferredSample: missingInPreferred.slice(0, 10),
    reconciled,
  };

  lastRunAt = now;
  return cached;
}
