import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

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

const RECONCILE_INTERVAL_MS = 1000 * 60 * 3;

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
      preferred.cortanaEpic.findMany(),
      preferred.cortanaTask.findMany(),
    ]);

    const preferredEpicIds = preferredEpics.map((epic) => epic.id);
    const preferredTaskIds = preferredTasks.map((task) => task.id);

    await prisma.$transaction(async (tx) => {
      for (const epic of preferredEpics) {
        await tx.cortanaEpic.upsert({
          where: { id: epic.id },
          create: {
            id: epic.id,
            title: epic.title,
            source: epic.source,
            status: epic.status,
            deadline: epic.deadline,
            createdAt: epic.createdAt,
            completedAt: epic.completedAt,
            metadata: epic.metadata,
          },
          update: {
            title: epic.title,
            source: epic.source,
            status: epic.status,
            deadline: epic.deadline,
            createdAt: epic.createdAt,
            completedAt: epic.completedAt,
            metadata: epic.metadata,
          },
        });
      }

      for (const task of preferredTasks) {
        await tx.cortanaTask.upsert({
          where: { id: task.id },
          create: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: task.status,
            dueAt: task.dueAt,
            remindAt: task.remindAt,
            executeAt: task.executeAt,
            autoExecutable: task.autoExecutable,
            executionPlan: task.executionPlan,
            dependsOn: task.dependsOn ?? [],
            completedAt: task.completedAt,
            outcome: task.outcome,
            metadata: task.metadata,
            epicId: task.epicId,
            parentId: task.parentId,
            assignedTo: task.assignedTo,
            source: task.source,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
          update: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: task.status,
            dueAt: task.dueAt,
            remindAt: task.remindAt,
            executeAt: task.executeAt,
            autoExecutable: task.autoExecutable,
            executionPlan: task.executionPlan,
            dependsOn: task.dependsOn ?? [],
            completedAt: task.completedAt,
            outcome: task.outcome,
            metadata: task.metadata,
            epicId: task.epicId,
            parentId: task.parentId,
            assignedTo: task.assignedTo,
            source: task.source,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        });
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
