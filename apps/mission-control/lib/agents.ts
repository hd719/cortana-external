import prisma from "@/lib/prisma";
import { unstable_noStore as noStore } from "next/cache";
import { deriveEvidenceGrade, deriveLaunchPhase, extractProviderPath } from "@/lib/run-intelligence";
import { AgentOperationalStats, AgentRecentRun, computeHealthScore, deriveHealthBand } from "@/lib/agent-health";
import { getAgentModelDisplay, getAgentProfiles } from "@/lib/agent-models";
import { normalizeIdentity, refreshOpenClawState, latestRunOrder } from "@/lib/data-helpers";

export const getAgents = async (options?: { refreshRuns?: boolean }) => {
  noStore();
  if (options?.refreshRuns !== false) {
    await refreshOpenClawState();
  }

  /* Read the agent roster from config/agent-profiles.json (source of truth)
     and enrich with DB runtime data (runs and health). */
  const profiles = getAgentProfiles();

  const [dbAgents, runs] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.run.findMany({
      where: { agentId: { not: null } },
      select: { agentId: true, status: true, updatedAt: true },
      take: 2000,
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  /* Build a lookup of DB agents by id and normalized name for matching */
  const dbAgentById = new Map(dbAgents.map((a) => [a.id, a]));
  const dbAgentByName = new Map(dbAgents.map((a) => [normalizeIdentity(a.name), a]));

  /* Merge: use profiles as the canonical roster, overlay with DB metadata */
  const agents = profiles.map((profile) => {
    const dbMatch = dbAgentById.get(profile.id) ?? dbAgentByName.get(normalizeIdentity(profile.name));
    return {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      description: dbMatch?.description ?? null,
      capabilities: profile.capabilities,
      model: profile.model,
      status: dbMatch?.status ?? "active",
      healthScore: dbMatch?.healthScore ?? null,
      lastSeen: dbMatch?.lastSeen ?? null,
      createdAt: dbMatch?.createdAt ?? new Date(),
      updatedAt: dbMatch?.updatedAt ?? new Date(),
    };
  });

  const statsByAgent = new Map<string, AgentOperationalStats>();

  const ensureStats = (agentId: string) => {
    if (!statsByAgent.has(agentId)) {
      statsByAgent.set(agentId, {
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
      });
    }
    return statsByAgent.get(agentId)!;
  };

  const MAX_TERMINAL_RUNS_PER_AGENT = 60;
  const terminalRunsCountByAgent = new Map<string, number>();
  const recentRunsByAgent = new Map<string, AgentRecentRun[]>();

  for (const run of runs) {
    if (!run.agentId) continue;

    if (
      run.status !== "completed" &&
      run.status !== "failed" &&
      run.status !== "cancelled"
    ) {
      continue;
    }

    const counted = terminalRunsCountByAgent.get(run.agentId) || 0;
    if (counted >= MAX_TERMINAL_RUNS_PER_AGENT) continue;

    terminalRunsCountByAgent.set(run.agentId, counted + 1);

    const stats = ensureStats(run.agentId);
    if (run.status === "completed") stats.completedRuns += 1;
    else if (run.status === "failed") stats.failedRuns += 1;
    else if (run.status === "cancelled") stats.cancelledRuns += 1;

    const recentRuns = recentRunsByAgent.get(run.agentId) || [];
    recentRuns.push({
      status:
        run.status === "completed"
          ? "completed"
          : run.status === "failed"
            ? "failed"
            : "cancelled",
      timestamp: run.updatedAt,
    });
    recentRunsByAgent.set(run.agentId, recentRuns);
  }

  return agents.map((agent) => {
    const stats = statsByAgent.get(agent.id) || {
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
    };

    const healthScore = computeHealthScore(stats, recentRunsByAgent.get(agent.id));
    const healthBand = deriveHealthBand(healthScore);
    const modelInfo = getAgentModelDisplay(agent.name, agent.model);

    return {
      ...agent,
      model: modelInfo.key,
      modelDisplay: modelInfo.displayName,
      healthScore,
      status:
        agent.status === "offline" && healthBand === "critical"
          ? "offline"
          : healthBand === "healthy"
            ? "active"
            : "degraded",
      healthBand,
    };
  });
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
  await refreshOpenClawState();

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const liveAgent = (await getAgents({ refreshRuns: false })).find((candidate) => candidate.id === agentId) ?? agent;

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
      confidence: deriveEvidenceGrade(run),
      launchPhase: deriveLaunchPhase(run),
      providerPath: extractProviderPath(run.payload ?? null),
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
