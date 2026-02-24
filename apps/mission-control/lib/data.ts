import { cache } from "react";
import prisma from "@/lib/prisma";
import { AgentStatus, RunStatus, Severity } from "@prisma/client";

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
