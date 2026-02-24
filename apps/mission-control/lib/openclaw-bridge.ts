import { Prisma, RunStatus, Severity } from "@prisma/client";
import prisma from "@/lib/prisma";

export type OpenClawLifecycleStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "killed";

export type OpenClawLifecycleEvent = {
  runId: string;
  status: OpenClawLifecycleStatus;
  agentId?: string;
  agentName?: string;
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
  const normalizedStatus = event.status.toLowerCase() as OpenClawLifecycleStatus;
  const startedAt = event.timestamp ? new Date(event.timestamp) : new Date();

  let agentId = event.agentId;
  if (!agentId && event.agentName) {
    const agent = await prisma.agent.findFirst({
      where: { name: { equals: event.agentName, mode: "insensitive" } },
      select: { id: true },
    });
    agentId = agent?.id;
  }

  const existing = await prisma.run.findFirst({
    where: { openclawRunId: event.runId },
    select: { id: true, startedAt: true },
  });

  const status = runStatusFromLifecycle(normalizedStatus);
  const isTerminal = ["done", "failed", "timeout", "killed"].includes(normalizedStatus);

  const run = existing
    ? await prisma.run.update({
        where: { id: existing.id },
        data: {
          agentId,
          jobType: event.jobType ?? "openclaw-subagent",
          status,
          externalStatus: normalizedStatus,
          summary: event.summary ?? undefined,
          payload: event.metadata ?? undefined,
          completedAt: isTerminal ? startedAt : null,
        },
      })
    : await prisma.run.create({
        data: {
          openclawRunId: event.runId,
          agentId,
          jobType: event.jobType ?? "openclaw-subagent",
          status,
          externalStatus: normalizedStatus,
          summary: event.summary,
          payload: event.metadata ?? undefined,
          startedAt,
          completedAt: isTerminal ? startedAt : null,
        },
      });

  await prisma.event.create({
    data: {
      agentId,
      runId: run.id,
      type: `subagent.${normalizedStatus}`,
      severity: severityFromLifecycle(normalizedStatus),
      message:
        event.summary ?? `OpenClaw sub-agent ${event.runId} transitioned to ${normalizedStatus}`,
      metadata: {
        ...(typeof event.metadata === "object" && event.metadata ? (event.metadata as object) : {}),
        source: "openclaw-subagent",
        openclawRunId: event.runId,
        externalStatus: normalizedStatus,
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
