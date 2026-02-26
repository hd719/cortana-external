import prisma from "./prisma";

export async function reconcileStaleRuns(maxAgeMinutes = 30): Promise<number> {
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Run"
    SET status = 'completed',
        "completedAt" = NOW(),
        summary = 'Auto-reconciled: no active session found'
    WHERE status = 'running'
      AND "startedAt" < NOW() - INTERVAL '${maxAgeMinutes} minutes'
  `);
  return result;
}
