import { Prisma, RunStatus, Severity } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolveAssignedAgentId } from "@/lib/openclaw-assignment";
import { deriveEvidenceGrade } from "@/lib/run-intelligence";

export type OpenClawLifecycleStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "killed";

export const normalizeLifecycleStatus = (status: string): OpenClawLifecycleStatus | null => {
  const normalized = status.trim().toLowerCase();
  if (["queued", "running", "done", "failed", "timeout", "killed"].includes(normalized)) {
    return normalized as OpenClawLifecycleStatus;
  }

  if (["completed", "complete", "success", "succeeded", "ok"].includes(normalized)) {
    return "done";
  }

  if (["cancelled", "canceled", "aborted", "abort"].includes(normalized)) {
    return "killed";
  }

  if (["error", "errored"].includes(normalized)) {
    return "failed";
  }

  return null;
};

export type OpenClawLifecycleEvent = {
  runId: string;
  status: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  jobType?: string;
  summary?: string;
  taskId?: number;
  taskStatus?: string;
  metadata?: Prisma.JsonValue;
  timestamp?: string;
};

const runStatusFromLifecycle = (status: OpenClawLifecycleStatus): RunStatus => {
  if (status === "done") return RunStatus.completed;
  if (status === "failed" || status === "timeout") return RunStatus.failed;
  if (status === "killed") return RunStatus.cancelled;
  if (status === "running") return RunStatus.running;
  return RunStatus.queued;
};

const severityFromLifecycle = (status: OpenClawLifecycleStatus): Severity => {
  if (status === "failed" || status === "timeout" || status === "killed") return Severity.critical;
  if (status === "running") return Severity.info;
  return Severity.info;
};

export async function ingestOpenClawLifecycleEvent(event: OpenClawLifecycleEvent) {
  const normalizedStatus = normalizeLifecycleStatus(event.status);
  if (!normalizedStatus) {
    throw new Error(`Unsupported OpenClaw lifecycle status: ${event.status}`);
  }

  const startedAt = event.timestamp ? new Date(event.timestamp) : new Date();

  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, role: true },
  });

  const { agentId } = resolveAssignedAgentId(
    {
      agentId: event.agentId,
      agentName: event.agentName,
      role: event.role,
      label: event.jobType,
      jobType: event.jobType,
      summary: event.summary,
      metadata: event.metadata,
    },
    agents
  );

  const existing = await prisma.run.findFirst({
    where: { openclawRunId: event.runId },
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      externalStatus: true,
      status: true,
      agentId: true,
      summary: true,
    },
  });

  const status = runStatusFromLifecycle(normalizedStatus);
  const isTerminal = ["done", "failed", "timeout", "killed"].includes(normalizedStatus);

  const launchPhase =
    normalizedStatus === "queued"
      ? "phase1_queued"
      : normalizedStatus === "running"
        ? existing?.externalStatus === "queued" || !existing
          ? "phase2_running_confirmed"
          : "phase2_running_unconfirmed"
        : "terminal";

  const shouldUpdateRun =
    !existing ||
    existing.externalStatus !== normalizedStatus ||
    existing.status !== status ||
    (!!agentId && existing.agentId !== agentId) ||
    (!!event.summary && event.summary !== existing.summary) ||
    (isTerminal && !existing.completedAt);

  const run = existing
    ? shouldUpdateRun
      ? await prisma.run.update({
          where: { id: existing.id },
          data: {
            agentId: agentId ?? existing.agentId,
            jobType: event.jobType ?? "openclaw-subagent",
            status,
            externalStatus: normalizedStatus,
            summary: event.summary ?? undefined,
            payload: {
              ...(typeof event.metadata === "object" && event.metadata ? (event.metadata as object) : {}),
              launchPhase,
              confirmationProtocol: "two-phase",
            },
            completedAt: isTerminal ? existing.completedAt ?? startedAt : null,
          },
        })
      : await prisma.run.findUniqueOrThrow({ where: { id: existing.id } })
    : await prisma.run.create({
        data: {
          openclawRunId: event.runId,
          agentId,
          jobType: event.jobType ?? "openclaw-subagent",
          status,
          externalStatus: normalizedStatus,
          summary: event.summary,
          payload: {
            ...(typeof event.metadata === "object" && event.metadata ? (event.metadata as object) : {}),
            launchPhase,
            confirmationProtocol: "two-phase",
          },
          startedAt,
          completedAt: isTerminal ? startedAt : null,
        },
      });

  if (!shouldUpdateRun) {
    return run;
  }

  const confidence = deriveEvidenceGrade({
    externalStatus: normalizedStatus,
    completedAt: isTerminal ? startedAt : null,
    payload: run.payload,
    summary: event.summary ?? run.summary,
  });

  await prisma.event.create({
    data: {
      agentId: agentId ?? run.agentId,
      runId: run.id,
      type: `subagent.${normalizedStatus}`,
      severity:
        launchPhase === "phase2_running_unconfirmed"
          ? Severity.warning
          : severityFromLifecycle(normalizedStatus),
      message:
        launchPhase === "phase2_running_unconfirmed"
          ? `OpenClaw sub-agent ${event.runId} reported running without prior queue confirmation`
          : event.summary ?? `OpenClaw sub-agent ${event.runId} transitioned to ${normalizedStatus}`,
      metadata: {
        ...(typeof event.metadata === "object" && event.metadata ? (event.metadata as object) : {}),
        source: "openclaw-subagent",
        openclawRunId: event.runId,
        externalStatus: normalizedStatus,
        launchPhase,
        confidence,
      },
    },
  });

  if (event.taskId) {
    const taskUpdate: Prisma.CortanaTaskUpdateManyMutationInput = {};

    if (event.taskStatus) {
      taskUpdate.status = event.taskStatus;
    } else if (normalizedStatus === "running") {
      taskUpdate.status = "in_progress";
    } else if (normalizedStatus === "done") {
      taskUpdate.status = "done";
    } else if (["failed", "timeout", "killed"].includes(normalizedStatus)) {
      taskUpdate.status = "failed";
    }

    if (isTerminal) {
      taskUpdate.outcome = event.summary ?? `Run ${event.runId}: ${normalizedStatus}`;
      taskUpdate.completedAt = startedAt;
    }

    if (Object.keys(taskUpdate).length > 0) {
      await prisma.cortanaTask.updateMany({
        where: { id: event.taskId },
        data: taskUpdate,
      });
    }
  }

  return run;
}

export async function backfillOpenClawRunAssignments(limit = 100) {
  const [agents, runs] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, name: true, role: true } }),
    prisma.run.findMany({
      where: {
        openclawRunId: { not: null },
        agentId: null,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        jobType: true,
        summary: true,
        payload: true,
      },
    }),
  ]);

  let updated = 0;
  for (const run of runs) {
    const assignment = resolveAssignedAgentId(
      {
        jobType: run.jobType,
        label: run.jobType,
        summary: run.summary,
        payload: run.payload,
      },
      agents
    );

    if (!assignment.agentId) continue;

    await prisma.run.update({
      where: { id: run.id },
      data: { agentId: assignment.agentId },
    });
    updated += 1;
  }

  return { scanned: runs.length, updated };
}
