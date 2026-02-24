import prisma from "@/lib/prisma";
import { AgentStatus, Prisma, RunStatus, Severity } from "@prisma/client";
import { unstable_noStore as noStore } from "next/cache";
import { syncOpenClawRunsFromStore } from "@/lib/openclaw-sync";
import { getTaskPrisma } from "@/lib/task-prisma";

type AgentHealthBand = "healthy" | "degraded" | "critical";

type AgentOperationalStats = {
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  completedTasks: number;
  failedTasks: number;
};

const normalizeIdentity = (value?: string | null) =>
  (value || "").trim().toLowerCase();

const deriveHealthBand = (score: number): AgentHealthBand => {
  if (score >= 75) return "healthy";
  if (score >= 45) return "degraded";
  return "critical";
};

const computeHealthScore = (stats: AgentOperationalStats) => {
  const runTerminal = stats.completedRuns + stats.failedRuns + stats.cancelledRuns;
  const taskTerminal = stats.completedTasks + stats.failedTasks;

  const runReliability = runTerminal > 0 ? stats.completedRuns / runTerminal : 0.6;
  const taskReliability = taskTerminal > 0 ? stats.completedTasks / taskTerminal : 0.6;

  const reliabilityScore = (runReliability * 0.6 + taskReliability * 0.4) * 70;
  const completionVolume = Math.min(30, stats.completedRuns * 5 + stats.completedTasks * 2);

  return Math.max(0, Math.min(100, Math.round(reliabilityScore + completionVolume)));
};

export const getAgents = async () => {
  noStore();
  await syncOpenClawRunsFromStore();

  const [agents, runs, tasks] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.run.findMany({
      where: { agentId: { not: null } },
      select: { agentId: true, status: true },
      take: 2000,
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.cortanaTask.findMany({
      where: { assignedTo: { not: null } },
      select: { assignedTo: true, status: true },
      take: 4000,
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  const statsByAgent = new Map<string, AgentOperationalStats>();

  const ensureStats = (agentId: string) => {
    if (!statsByAgent.has(agentId)) {
      statsByAgent.set(agentId, {
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        completedTasks: 0,
        failedTasks: 0,
      });
    }
    return statsByAgent.get(agentId)!;
  };

  for (const run of runs) {
    if (!run.agentId) continue;
    const stats = ensureStats(run.agentId);
    if (run.status === RunStatus.completed) stats.completedRuns += 1;
    else if (run.status === RunStatus.failed) stats.failedRuns += 1;
    else if (run.status === RunStatus.cancelled) stats.cancelledRuns += 1;
  }

  const agentIdsByIdentity = new Map<string, string[]>();
  for (const agent of agents) {
    const keys = [agent.id, agent.name, agent.role].map(normalizeIdentity).filter(Boolean);
    for (const key of keys) {
      const existing = agentIdsByIdentity.get(key) || [];
      if (!existing.includes(agent.id)) existing.push(agent.id);
      agentIdsByIdentity.set(key, existing);
    }
  }

  for (const task of tasks) {
    const assigneeKey = normalizeIdentity(task.assignedTo);
    if (!assigneeKey) continue;

    const matches = agentIdsByIdentity.get(assigneeKey) || [];
    if (matches.length === 0) continue;

    const normalizedTaskStatus = task.status.toLowerCase();
    for (const agentId of matches) {
      const stats = ensureStats(agentId);
      if (["done", "completed"].includes(normalizedTaskStatus)) stats.completedTasks += 1;
      else if (["failed", "cancelled", "canceled", "timeout", "killed"].includes(normalizedTaskStatus)) {
        stats.failedTasks += 1;
      }
    }
  }

  return agents.map((agent) => {
    const stats = statsByAgent.get(agent.id) || {
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      completedTasks: 0,
      failedTasks: 0,
    };

    const healthScore = computeHealthScore(stats);
    const healthBand = deriveHealthBand(healthScore);

    return {
      ...agent,
      healthScore,
      status:
        agent.status === AgentStatus.offline && healthBand === "critical"
          ? AgentStatus.offline
          : healthBand === "healthy"
            ? AgentStatus.active
            : AgentStatus.degraded,
      healthBand,
    };
  });
};

const latestRunOrder: Prisma.RunOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { updatedAt: "desc" },
  { startedAt: "desc" },
  { id: "desc" },
];

type GetRunsInput = {
  take?: number;
  cursor?: string;
  agentId?: string;
};

export type RunsPage = {
  runs: Prisma.RunGetPayload<{ include: { agent: true } }>[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const getRuns = async ({ take = 20, cursor, agentId }: GetRunsInput = {}): Promise<RunsPage> => {
  noStore();
  await syncOpenClawRunsFromStore();

  const normalizedTake = Math.max(1, Math.min(take, 100));

  const runs = await prisma.run.findMany({
    include: { agent: true },
    where: agentId ? { agentId } : undefined,
    orderBy: latestRunOrder,
    take: normalizedTake + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
  });

  const hasMore = runs.length > normalizedTake;
  const pageRuns = hasMore ? runs.slice(0, normalizedTake) : runs;
  const nextCursor = hasMore ? pageRuns[pageRuns.length - 1]?.id ?? null : null;

  return {
    runs: pageRuns,
    hasMore,
    nextCursor,
  };
};

export const getEvents = async () => {
  noStore();
  await syncOpenClawRunsFromStore();
  return prisma.event.findMany({
    include: { agent: true, run: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
};

export const getDashboardSummary = async () => {
  noStore();
  await syncOpenClawRunsFromStore();
  const [agents, runs, events] = await Promise.all([
    getAgents(),
    prisma.run.findMany({
      include: { agent: true },
      orderBy: latestRunOrder,
      take: 10,
    }),
    prisma.event.findMany({
      include: { agent: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const agentCounts = agents.reduce(
    (acc, agent) => {
      acc.total += 1;
      acc.byStatus[agent.status] = (acc.byStatus[agent.status] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {} as Record<AgentStatus, number> }
  );

  const runCounts = runs.reduce(
    (acc, run) => {
      acc.total += 1;
      acc.byStatus[run.status] = (acc.byStatus[run.status] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {} as Record<RunStatus, number> }
  );

  const alertCounts = events.reduce(
    (acc, event) => {
      acc.total += 1;
      acc.bySeverity[event.severity] =
        (acc.bySeverity[event.severity] || 0) + 1;
      return acc;
    },
    { total: 0, bySeverity: {} as Record<Severity, number> }
  );

  return {
    agents,
    runs,
    events,
    metrics: {
      agents: agentCounts,
      runs: runCounts,
      alerts: alertCounts,
    },
  };
};

export type TaskBoardTask = Prisma.CortanaTaskGetPayload<{
  include: { epic: true };
}> & {
  dependencyReady: boolean;
  blockedBy: Array<{ id: number; title: string; status: string }>;
};

const pillarFromMetadata = (metadata: Prisma.JsonValue | null): string => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "Unspecified";
  }

  const pillar = (metadata as Record<string, unknown>).pillar;
  return typeof pillar === "string" && pillar.length > 0 ? pillar : "Unspecified";
};

const LEGACY_GHOST_TASK_TITLE = "Enable auto-remediation for heartbeat misses";
let ghostTaskPruned = false;

const pruneLegacyGhostTask = async () => {
  if (ghostTaskPruned) return;

  await prisma.cortanaTask.deleteMany({
    where: {
      source: "seed",
      title: LEGACY_GHOST_TASK_TITLE,
    },
  });

  ghostTaskPruned = true;
};

export const getTaskBoard = async () => {
  noStore();

  const taskPrisma = getTaskPrisma() ?? prisma;
  if (taskPrisma === prisma) {
    await pruneLegacyGhostTask();
  }

  const tasks = await taskPrisma.cortanaTask.findMany({
    include: { epic: true },
    orderBy: [{ dueAt: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
  });

  const tasksById = tasks.reduce<
    Record<number, Prisma.CortanaTaskGetPayload<{ include: { epic: true } }>>
  >((acc, task) => {
    acc[task.id] = task;
    return acc;
  }, {});

  const annotated: TaskBoardTask[] = tasks.map((task) => {
    const dependencies = task.dependsOn || [];
    const blockers = dependencies
      .map((id) => ({ id, task: tasksById[id] }))
      .filter(({ task }) => {
        if (!task) return true;
        const normalized = task.status.toLowerCase();
        return !["done", "completed"].includes(normalized);
      });

    const blockedBy = blockers.map(({ id, task }) =>
      task
        ? { id: task.id, title: task.title, status: task.status }
        : { id, title: "Unknown dependency", status: "missing" }
    );

    return {
      ...task,
      dependencyReady: blockers.length === 0,
      blockedBy,
    };
  });

  const now = new Date();
  const soon = new Date(now.getTime() + 1000 * 60 * 60 * 48);

  const readyNow = annotated.filter(
    (task) =>
      task.status === "pending" &&
      task.autoExecutable &&
      task.dependencyReady
  );

  const blocked = annotated.filter(
    (task) =>
      task.status === "pending" &&
      (task.dependsOn?.length || 0) > 0 &&
      !task.dependencyReady
  );

  const dueSoon = annotated.filter(
    (task) =>
      task.status === "pending" &&
      task.dueAt &&
      task.dueAt >= now &&
      task.dueAt <= soon
  );

  const overdue = annotated.filter(
    (task) =>
      task.status === "pending" &&
      task.dueAt &&
      task.dueAt < now
  );

  const byPillar = annotated.reduce<Record<string, TaskBoardTask[]>>(
    (acc, task) => {
      const pillar = pillarFromMetadata(task.metadata ?? null);
      if (!acc[pillar]) acc[pillar] = [];
      acc[pillar].push(task);
      return acc;
    },
    {}
  );

  const recentOutcomes = annotated
    .filter((task) => task.outcome || task.completedAt)
    .sort((a, b) => {
      const aTime = a.completedAt?.getTime() || a.updatedAt.getTime();
      const bTime = b.completedAt?.getTime() || b.updatedAt.getTime();
      return bTime - aTime;
    })
    .slice(0, 10);

  return {
    tasks: annotated,
    readyNow,
    blocked,
    dueSoon,
    overdue,
    byPillar,
    recentOutcomes,
  };
};

const minutesBetween = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

const durationLabel = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
};

export const getAgentDetail = async (agentId: string) => {
  noStore();
  await syncOpenClawRunsFromStore();

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const liveAgent = (await getAgents()).find((candidate) => candidate.id === agentId) ?? agent;

  const [recentRuns, recentEvents] = await Promise.all([
    prisma.run.findMany({
      where: { agentId },
      orderBy: latestRunOrder,
      take: 25,
    }),
    prisma.event.findMany({
      where: { agentId },
      include: { run: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const runSummaries = recentRuns.map((run) => {
    const endTime = run.completedAt ?? new Date();
    const minutes = minutesBetween(run.startedAt, endTime);
    return {
      ...run,
      durationMinutes: minutes,
      durationLabel: durationLabel(minutes),
      timedOut:
        run.status === "failed" &&
        (run.summary?.toLowerCase().includes("timeout") ||
          recentEvents.some(
            (event) =>
              event.runId === run.id &&
              (event.type.toLowerCase().includes("timeout") ||
                event.message.toLowerCase().includes("timeout"))
          )),
    };
  });

  const failureEvents = recentEvents.filter(
    (event) =>
      event.severity === "critical" ||
      event.type.toLowerCase().includes("fail") ||
      event.type.toLowerCase().includes("timeout") ||
      event.message.toLowerCase().includes("timeout")
  );

  return {
    agent: liveAgent,
    recentRuns: runSummaries,
    recentEvents,
    failureEvents,
  };
};
