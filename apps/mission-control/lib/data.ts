import { cache } from "react";
import prisma from "@/lib/prisma";
import { AgentStatus, Prisma, RunStatus, Severity } from "@prisma/client";

export const getAgents = cache(async () => {
  return prisma.agent.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
});

export const getRuns = cache(async () => {
  return prisma.run.findMany({
    include: { agent: true },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
});

export const getEvents = cache(async () => {
  return prisma.event.findMany({
    include: { agent: true, run: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
});

export const getDashboardSummary = cache(async () => {
  const [agents, runs, events] = await Promise.all([
    getAgents(),
    prisma.run.findMany({
      include: { agent: true },
      orderBy: { startedAt: "desc" },
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
});

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

export const getTaskBoard = cache(async () => {
  const tasks = await prisma.cortanaTask.findMany({
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
});
