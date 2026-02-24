import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

type ReconcileReport = {
  ranAt: string;
  drift: boolean;
  preferredCount: number;
  appCount: number;
  missingInAppSample: number[];
  missingInPreferredSample: number[];
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

  cached = {
    ranAt: new Date(now).toISOString(),
    drift: missingInApp.length > 0 || missingInPreferred.length > 0,
    preferredCount: preferredIds.length,
    appCount: appIds.length,
    missingInAppSample: missingInApp.slice(0, 10),
    missingInPreferredSample: missingInPreferred.slice(0, 10),
  };

  lastRunAt = now;
  return cached;
}
