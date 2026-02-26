import prisma from "@/lib/prisma";
import { AgentStatus, Prisma, RunStatus, Severity } from "@prisma/client";
import { unstable_noStore as noStore } from "next/cache";
import { syncOpenClawRunsFromStore } from "@/lib/openclaw-sync";
import { getTaskPrisma } from "@/lib/task-prisma";
import { reconcileTaskBoardSources } from "@/lib/task-reconciliation";
import { getTaskListenerStatus } from "@/lib/task-listener";
import { deriveEvidenceGrade, deriveLaunchPhase, extractProviderPath } from "@/lib/run-intelligence";
import {
  AgentOperationalStats,
  AgentRecentRun,
  computeHealthScore,
  deriveHealthBand,
} from "@/lib/agent-health";

const normalizeIdentity = (value?: string | null) =>
  (value || "").trim().toLowerCase();

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const deriveAssignmentLabel = (run: {
  agent?: { name: string } | null;
  payload?: Prisma.JsonValue | null;
  jobType: string;
}): string | null => {
  if (run.agent?.name) return run.agent.name;

  const payload = asObject(run.payload);
  const metadata = asObject((payload?.metadata as Prisma.JsonValue | undefined) ?? null);

  const candidates = [
    stringValue(payload?.assigned_to),
    stringValue(metadata?.assigned_to),
    stringValue(payload?.agent),
    stringValue(metadata?.agent),
    stringValue(payload?.role),
    stringValue(metadata?.role),
    stringValue(payload?.label),
    stringValue(metadata?.label),
    run.jobType && run.jobType !== "openclaw-subagent" ? run.jobType : null,
  ];

  return candidates.find(Boolean) ?? null;
};

const STALE_RUNNING_RECONCILE_MS = 1000 * 60 * 60 * 2;
const STALE_RUNNING_RECONCILE_NOTE = "auto-reconciled: stale running state";
let lastStaleRunReconcileAt = 0;

const appendReconcileNote = (summary: string | null) => {
  if (!summary || summary.trim().length === 0) return STALE_RUNNING_RECONCILE_NOTE;
  return summary.includes(STALE_RUNNING_RECONCILE_NOTE)
    ? summary
    : `${summary} | ${STALE_RUNNING_RECONCILE_NOTE}`;
};

const reconcileStaleRunningRuns = async () => {
  const now = Date.now();
  if (now - lastStaleRunReconcileAt < 60_000) return 0;

  const staleBefore = new Date(now - STALE_RUNNING_RECONCILE_MS);
  const staleRuns = await prisma.run.findMany({
    where: {
      status: RunStatus.running,
      updatedAt: { lt: staleBefore },
    },
    select: {
      id: true,
      summary: true,
    },
  });

  if (staleRuns.length === 0) {
    lastStaleRunReconcileAt = now;
    return 0;
  }

  await prisma.$transaction(
    staleRuns.map((run) =>
      prisma.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.failed,
          summary: appendReconcileNote(run.summary),
          completedAt: new Date(),
          externalStatus: "failed",
        },
      })
    )
  );

  lastStaleRunReconcileAt = now;
  return staleRuns.length;
};

export const getAgents = async () => {
  noStore();
  await syncOpenClawRunsFromStore();
  await reconcileStaleRunningRuns();

  const taskPrisma = getTaskPrisma();

  const [agents, runs, tasks] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.run.findMany({
      where: { agentId: { not: null } },
      select: { agentId: true, status: true, updatedAt: true },
      take: 2000,
      orderBy: [{ updatedAt: "desc" }],
    }),
    (taskPrisma ?? prisma).cortanaTask.findMany({
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

  const MAX_TERMINAL_RUNS_PER_AGENT = 60;
  const terminalRunsCountByAgent = new Map<string, number>();
  const recentRunsByAgent = new Map<string, AgentRecentRun[]>();

  for (const run of runs) {
    if (!run.agentId) continue;

    if (
      run.status !== RunStatus.completed &&
      run.status !== RunStatus.failed &&
      run.status !== RunStatus.cancelled
    ) {
      continue;
    }

    const counted = terminalRunsCountByAgent.get(run.agentId) || 0;
    if (counted >= MAX_TERMINAL_RUNS_PER_AGENT) continue;

    terminalRunsCountByAgent.set(run.agentId, counted + 1);

    const stats = ensureStats(run.agentId);
    if (run.status === RunStatus.completed) stats.completedRuns += 1;
    else if (run.status === RunStatus.failed) stats.failedRuns += 1;
    else if (run.status === RunStatus.cancelled) stats.cancelledRuns += 1;

    const recentRuns = recentRunsByAgent.get(run.agentId) || [];
    recentRuns.push({
      status:
        run.status === RunStatus.completed
          ? "completed"
          : run.status === RunStatus.failed
            ? "failed"
            : "cancelled",
      timestamp: run.updatedAt,
    });
    recentRunsByAgent.set(run.agentId, recentRuns);
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

  const MAX_TERMINAL_TASKS_PER_AGENT = 80;
  const terminalTasksCountByAgent = new Map<string, number>();

  for (const task of tasks) {
    const assigneeKey = normalizeIdentity(task.assignedTo);
    if (!assigneeKey) continue;

    const matches = agentIdsByIdentity.get(assigneeKey) || [];
    if (matches.length === 0) continue;

    const normalizedTaskStatus = task.status.toLowerCase();
    const isCompletedTask = ["done", "completed"].includes(normalizedTaskStatus);
    const isFailedTask = ["failed", "cancelled", "canceled", "timeout", "killed"].includes(
      normalizedTaskStatus
    );

    if (!isCompletedTask && !isFailedTask) continue;

    for (const agentId of matches) {
      const counted = terminalTasksCountByAgent.get(agentId) || 0;
      if (counted >= MAX_TERMINAL_TASKS_PER_AGENT) continue;

      terminalTasksCountByAgent.set(agentId, counted + 1);

      const stats = ensureStats(agentId);
      if (isCompletedTask) stats.completedTasks += 1;
      else if (isFailedTask) stats.failedTasks += 1;
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

    const healthScore = computeHealthScore(stats, recentRunsByAgent.get(agent.id));
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

  const enrichedRuns = pageRuns.map((run) => ({
    ...run,
    confidence: deriveEvidenceGrade(run),
    launchPhase: deriveLaunchPhase(run),
    providerPath: extractProviderPath(run.payload ?? null),
    assignmentLabel: deriveAssignmentLabel(run),
  }));

  return {
    runs: enrichedRuns,
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
    runs: runs.map((run) => ({
      ...run,
      assignmentLabel: deriveAssignmentLabel(run),
    })),
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

type TaskBoardWarning = {
  code: "task_db_fallback" | "task_source_drift" | "task_listener_disconnected";
  message: string;
  cause?: string;
};

const readTaskBoardTasks = async (
  client: typeof prisma,
  options?: { pruneGhostTask?: boolean }
) => {
  if (options?.pruneGhostTask) {
    await pruneLegacyGhostTask();
  }

  return client.cortanaTask.findMany({
    include: { epic: true },
    orderBy: [{ dueAt: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
  });
};

type GetTaskBoardInput = {
  completedLimit?: number;
  completedOffset?: number;
};

const COMPLETED_STATUSES = new Set(["done", "completed"]);
const DEFAULT_COMPLETED_PAGE_SIZE = 20;
const MAX_COMPLETED_PAGE_SIZE = 100;

const completionTime = (task: TaskBoardTask) => task.completedAt?.getTime() ?? task.updatedAt.getTime();

const activeTaskSortRank = (task: TaskBoardTask) => {
  if (task.status === "in_progress") return 0;
  if (task.status === "blocked") return 1;
  if (task.status === "pending" && !task.dependencyReady) return 1;
  if (task.status === "pending") return 2;
  return 3;
};

export const getTaskBoard = async ({
  completedLimit = DEFAULT_COMPLETED_PAGE_SIZE,
  completedOffset = 0,
}: GetTaskBoardInput = {}) => {
  noStore();

  const preferredTaskPrisma = getTaskPrisma();
  let taskSource: "cortana" | "app" = preferredTaskPrisma ? "cortana" : "app";
  const warnings: TaskBoardWarning[] = [];

  let tasks: Prisma.CortanaTaskGetPayload<{ include: { epic: true } }>[];

  try {
    tasks = await readTaskBoardTasks(preferredTaskPrisma ?? prisma, {
      pruneGhostTask: !preferredTaskPrisma,
    });
  } catch (error) {
    if (!preferredTaskPrisma) {
      throw error;
    }

    console.warn("Task board cortana DB unavailable, falling back to app DB", error);
    taskSource = "app";
    warnings.push({
      code: "task_db_fallback",
      message:
        "Dedicated task database is unavailable. Showing tasks from the app database until cortana DB recovers.",
      cause: error instanceof Error ? error.message : "Unknown task DB error",
    });

    tasks = await readTaskBoardTasks(prisma, { pruneGhostTask: true });
  }

  const listener = getTaskListenerStatus();

  const reconcileReport = await reconcileTaskBoardSources();
  if (reconcileReport?.drift && !listener.connected) {
    warnings.push({
      code: "task_source_drift",
      message: `Source-of-truth drift detected (preferred=${reconcileReport.preferredCount}, app=${reconcileReport.appCount}). Auto-reconcile is monitoring and this UI is anchored to ${taskSource}.`,
      cause: `missingInApp=${reconcileReport.missingInAppSample.join(",") || "none"}; missingInPreferred=${reconcileReport.missingInPreferredSample.join(",") || "none"}`,
    });
  }

  if (listener.enabled && listener.started && !listener.connected) {
    warnings.push({
      code: "task_listener_disconnected",
      message:
        "Live task sync listener is disconnected. Falling back to periodic reconciliation until connection recovers.",
      cause: listener.lastError ?? undefined,
    });
  }

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
        return !COMPLETED_STATUSES.has(normalized);
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

  const safeCompletedLimit = Math.max(1, Math.min(completedLimit, MAX_COMPLETED_PAGE_SIZE));
  const safeCompletedOffset = Math.max(0, completedOffset);

  const completedTasks = annotated
    .filter((task) => COMPLETED_STATUSES.has(task.status.toLowerCase()))
    .sort((a, b) => completionTime(b) - completionTime(a));

  const activeTasks = annotated
    .filter((task) => !COMPLETED_STATUSES.has(task.status.toLowerCase()))
    .sort((a, b) => {
      const rankDiff = activeTaskSortRank(a) - activeTaskSortRank(b);
      if (rankDiff !== 0) return rankDiff;

      const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;

      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  const pagedCompletedTasks = completedTasks.slice(
    safeCompletedOffset,
    safeCompletedOffset + safeCompletedLimit
  );

  const now = new Date();
  const soon = new Date(now.getTime() + 1000 * 60 * 60 * 48);

  const readyNow = activeTasks.filter(
    (task) =>
      task.status === "pending" &&
      task.autoExecutable &&
      task.dependencyReady
  );

  const blocked = activeTasks.filter(
    (task) =>
      task.status === "pending" &&
      (task.dependsOn?.length || 0) > 0 &&
      !task.dependencyReady
  );

  const dueSoon = activeTasks.filter(
    (task) =>
      task.status === "pending" &&
      task.dueAt &&
      task.dueAt >= now &&
      task.dueAt <= soon
  );

  const overdue = activeTasks.filter(
    (task) =>
      task.status === "pending" &&
      task.dueAt &&
      task.dueAt < now
  );

  const byPillar = activeTasks.reduce<Record<string, TaskBoardTask[]>>(
    (acc, task) => {
      const pillar = pillarFromMetadata(task.metadata ?? null);
      if (!acc[pillar]) acc[pillar] = [];
      acc[pillar].push(task);
      return acc;
    },
    {}
  );

  const recentOutcomes = completedTasks.slice(0, 10);

  return {
    tasks: [...activeTasks, ...pagedCompletedTasks],
    activeTasks,
    completedTasks: pagedCompletedTasks,
    completedPagination: {
      total: completedTasks.length,
      offset: safeCompletedOffset,
      limit: safeCompletedLimit,
      hasMore: safeCompletedOffset + pagedCompletedTasks.length < completedTasks.length,
      nextOffset: safeCompletedOffset + pagedCompletedTasks.length,
    },
    readyNow,
    blocked,
    dueSoon,
    overdue,
    byPillar,
    recentOutcomes,
    metadata: {
      source: taskSource,
      warnings,
      reconciliation: reconcileReport,
      listener,
    },
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
