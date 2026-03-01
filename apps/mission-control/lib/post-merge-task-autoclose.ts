import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type InputJsonValue = JsonValue;

type MergeRef = {
  repository?: string;
  prNumber: number;
  prTitle?: string;
  prBody?: string;
  labels?: string[];
  mergeCommitSha?: string;
  commitMessages?: string[];
};

type CloseOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
};

export type MergeTaskClosureReceipt = {
  ok: boolean;
  mappedTaskIds: number[];
  attempts: number;
  prNumber: number;
  mergeCommitSha?: string;
  receipt: string;
  verification?: {
    doneTaskIds: number[];
    missingTaskIds: number[];
  };
  error?: string;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

const TASK_ID_PATTERNS = [
  /(?:^|\s)#(\d+)\b/g,
  /\btask(?:[\s_-]+id)?\s*[:#-]?\s*(\d+)\b/gi,
  /\bcortana[_-]?tasks?[#: -]+(\d+)\b/gi,
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractTaskIdsFromText = (text?: string | null): number[] => {
  if (!text) return [];

  const out = new Set<number>();
  for (const pattern of TASK_ID_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0) out.add(parsed);
    }
  }
  return [...out];
};

const extractTaskIdsFromLabels = (labels: string[] = []): number[] => {
  const ids = new Set<number>();

  for (const label of labels) {
    const lowered = label.toLowerCase();
    const labelMatches = lowered.match(/(?:task|cortana-task|task-id)\s*[:#-]?\s*(\d+)\b/);
    if (labelMatches) {
      const parsed = Number(labelMatches[1]);
      if (Number.isInteger(parsed) && parsed > 0) ids.add(parsed);
    }
  }

  return [...ids];
};

export const mapMergeToTaskIds = (ref: MergeRef): number[] => {
  const combined = new Set<number>();

  for (const id of extractTaskIdsFromText(ref.prTitle)) combined.add(id);
  for (const id of extractTaskIdsFromText(ref.prBody)) combined.add(id);
  for (const id of extractTaskIdsFromLabels(ref.labels)) combined.add(id);

  for (const message of ref.commitMessages || []) {
    for (const id of extractTaskIdsFromText(message)) combined.add(id);
  }

  return [...combined].sort((a, b) => a - b);
};

const formatOutcome = (ref: MergeRef) => {
  const pieces = [
    `auto-closed from merged PR #${ref.prNumber}`,
    ref.repository ? `repo=${ref.repository}` : undefined,
    ref.mergeCommitSha ? `commit=${ref.mergeCommitSha}` : undefined,
  ].filter(Boolean);

  return pieces.join(" | ");
};

type TaskStatusRow = {
  id: number;
  status: string | null;
};

const verifyClosedTasks = async (taskIds: number[]) => {
  const taskPrisma = getTaskPrisma() || prisma;
  const rows = (await taskPrisma.cortanaTask.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, status: true },
  })) as TaskStatusRow[];

  const doneTaskIds = rows
    .filter((row) => ["done", "completed"].includes((row.status || "").toLowerCase()))
    .map((row) => row.id)
    .sort((a, b) => a - b);

  const doneSet = new Set(doneTaskIds);
  const missingTaskIds = taskIds.filter((id) => !doneSet.has(id));

  return { doneTaskIds, missingTaskIds };
};

const emitFailureAlert = async (message: string, metadata: Record<string, unknown>) => {
  console.error(`[post-merge-task-autoclose] ${message}`, metadata);
  try {
    await prisma.event.create({
      data: {
        type: "task.autoclose.verification_failed",
        severity: "critical",
        message,
        metadata: metadata as InputJsonValue,
      },
    });
  } catch {
    // mission-control DB may be unavailable in standalone mode; console error above is still guaranteed
  }
};

export async function closeMappedTasksWithVerification(
  ref: MergeRef,
  options: CloseOptions = {}
): Promise<MergeTaskClosureReceipt> {
  const mappedTaskIds = mapMergeToTaskIds(ref);
  const maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryDelayMs = Math.max(100, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);

  if (mappedTaskIds.length === 0) {
    return {
      ok: true,
      mappedTaskIds,
      attempts: 0,
      prNumber: ref.prNumber,
      mergeCommitSha: ref.mergeCommitSha,
      receipt: `PR #${ref.prNumber} merged${ref.mergeCommitSha ? ` @ ${ref.mergeCommitSha}` : ""}; no mapped task IDs detected`,
      verification: { doneTaskIds: [], missingTaskIds: [] },
    };
  }

  const taskPrisma = getTaskPrisma() || prisma;
  const outcome = formatOutcome(ref);
  let attempts = 0;
  let verification = await verifyClosedTasks(mappedTaskIds);

  while (attempts < maxRetries && verification.missingTaskIds.length > 0) {
    attempts += 1;

    await taskPrisma.cortanaTask.updateMany({
      where: { id: { in: verification.missingTaskIds } },
      data: {
        status: "done",
        completedAt: new Date(),
        outcome,
      },
    });

    verification = await verifyClosedTasks(mappedTaskIds);
    if (verification.missingTaskIds.length === 0) break;
    if (attempts < maxRetries) await sleep(retryDelayMs);
  }

  const receipt = `PR #${ref.prNumber} merged${ref.mergeCommitSha ? ` @ ${ref.mergeCommitSha}` : ""}; closed tasks [${mappedTaskIds.join(", "
  )}]`;

  if (verification.missingTaskIds.length > 0) {
    const error = `Verification gate failed: tasks still not done after ${attempts} attempt(s): ${verification.missingTaskIds.join(", ")}`;
    await emitFailureAlert(error, {
      prNumber: ref.prNumber,
      mergeCommitSha: ref.mergeCommitSha,
      mappedTaskIds,
      missingTaskIds: verification.missingTaskIds,
      attempts,
    });

    return {
      ok: false,
      mappedTaskIds,
      attempts,
      prNumber: ref.prNumber,
      mergeCommitSha: ref.mergeCommitSha,
      receipt,
      verification,
      error,
    };
  }

  return {
    ok: true,
    mappedTaskIds,
    attempts,
    prNumber: ref.prNumber,
    mergeCommitSha: ref.mergeCommitSha,
    receipt,
    verification,
  };
}
