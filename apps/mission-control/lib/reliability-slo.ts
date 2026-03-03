import { Prisma } from "@prisma/client";
import { extractProviderPath } from "@/lib/run-intelligence";

export type ReliabilityRun = {
  status: string;
  externalStatus: string | null;
  startedAt: Date;
  completedAt: Date | null;
  payload: Prisma.JsonValue | null;
  summary: string | null;
};

export type ReliabilityJob = {
  enabled?: boolean;
  schedule?: { kind: string; [key: string]: unknown };
  delivery?: { mode?: string; to?: string };
  state?: {
    nextRunAtMs?: number;
    consecutiveErrors?: number;
    lastStatus?: string;
    lastDelivered?: boolean;
    lastDeliveryStatus?: string;
  };
};

export type ReliabilitySloMetrics = {
  cronOnTimePct: number;
  abortedRunRatePct: number;
  deliverySuccessPct: number;
  p95ResponseMs: number;
  api429RateByProvider: Array<{ provider: string; ratePct: number; total: number; count429: number }>;
  samples: {
    cronJobs: number;
    terminalRuns: number;
    deliveryRequiredJobs: number;
    responseSamples: number;
    providerSamples: number;
  };
};

const toPct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0);

const getExpectedIntervalMs = (schedule?: { kind: string; [key: string]: unknown }) => {
  if (!schedule) return null;
  if (schedule.kind === "every") {
    const ms = Number(schedule.everyMs ?? 0);
    return ms > 0 ? ms : null;
  }
  if (schedule.kind === "cron") return 60_000;
  return null;
};

const normalizeDeliveryMode = (delivery?: { mode?: string; to?: string }) => {
  const mode = delivery?.mode?.trim();
  return mode ? mode : "none";
};

const isNoReplyExpected = (delivery?: { mode?: string; to?: string }) => {
  const target = delivery?.to;
  if (!target) return false;
  return String(target).trim().toUpperCase() === "NO_REPLY";
};

const isFailedLike = (value: string | null | undefined) => {
  const status = (value || "").toLowerCase();
  return ["failed", "error", "timeout", "stale"].includes(status);
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const has429Signal = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "number") return value === 429;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return lower.includes("429") || lower.includes("rate limit");
  }
  if (Array.isArray(value)) return value.some((item) => has429Signal(item));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => has429Signal(entry));
  }
  return false;
};

const percentile = (values: number[], pct: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
};

export const computeReliabilitySloMetrics = (input: {
  jobs: ReliabilityJob[];
  runs: ReliabilityRun[];
  nowMs?: number;
}): ReliabilitySloMetrics => {
  const nowMs = input.nowMs ?? Date.now();

  const cronCandidates = input.jobs.filter((job) => {
    if (job.enabled === false) return false;
    if (!job.schedule) return false;
    return Boolean(getExpectedIntervalMs(job.schedule));
  });

  const cronOnTime = cronCandidates.filter((job) => {
    const nextRunAtMs = job.state?.nextRunAtMs;
    if (typeof nextRunAtMs !== "number") return false;
    if (nextRunAtMs <= nowMs) return false;
    if ((job.state?.consecutiveErrors ?? 0) > 0) return false;
    if (isFailedLike(job.state?.lastStatus)) return false;
    return true;
  }).length;

  const terminalRuns = input.runs.filter((run) => {
    const status = (run.externalStatus || run.status || "").toLowerCase();
    return ["done", "completed", "failed", "timeout", "killed", "cancelled", "canceled"].includes(status);
  });

  const abortedRuns = terminalRuns.filter((run) => {
    const external = (run.externalStatus || "").toLowerCase();
    const status = (run.status || "").toLowerCase();
    const payload = asObject(run.payload);
    const endedReason = String(payload?.endedReason || "").toLowerCase();

    return (
      external === "killed" ||
      external === "timeout" ||
      status === "cancelled" ||
      status === "canceled" ||
      ["aborted", "abort", "killed", "cancelled", "canceled", "timeout"].includes(endedReason)
    );
  }).length;

  const deliveryRequired = input.jobs.filter((job) => {
    if (job.enabled === false) return false;
    const mode = normalizeDeliveryMode(job.delivery).toLowerCase();
    return mode !== "none" && !isNoReplyExpected(job.delivery);
  });

  const deliverySuccess = deliveryRequired.filter((job) => {
    if (job.state?.lastDelivered === true) return true;
    return (job.state?.lastDeliveryStatus || "").toLowerCase() === "delivered";
  }).length;

  const responseSamples = terminalRuns
    .map((run) => {
      if (!run.completedAt) return null;
      const diff = run.completedAt.getTime() - run.startedAt.getTime();
      return diff > 0 ? diff : null;
    })
    .filter((value): value is number => typeof value === "number");

  const providerCounts = new Map<string, { total: number; count429: number }>();
  for (const run of terminalRuns) {
    const provider = extractProviderPath(run.payload).provider || "unknown";
    const normalizedProvider = provider.toLowerCase();
    const existing = providerCounts.get(normalizedProvider) || { total: 0, count429: 0 };
    existing.total += 1;
    if (has429Signal(run.payload) || has429Signal(run.summary)) {
      existing.count429 += 1;
    }
    providerCounts.set(normalizedProvider, existing);
  }

  const api429RateByProvider = [...providerCounts.entries()]
    .map(([provider, counts]) => ({
      provider,
      total: counts.total,
      count429: counts.count429,
      ratePct: toPct(counts.count429, counts.total),
    }))
    .sort((a, b) => b.ratePct - a.ratePct || b.total - a.total)
    .slice(0, 5);

  return {
    cronOnTimePct: toPct(cronOnTime, cronCandidates.length),
    abortedRunRatePct: toPct(abortedRuns, terminalRuns.length),
    deliverySuccessPct: toPct(deliverySuccess, deliveryRequired.length),
    p95ResponseMs: percentile(responseSamples, 95),
    api429RateByProvider,
    samples: {
      cronJobs: cronCandidates.length,
      terminalRuns: terminalRuns.length,
      deliveryRequiredJobs: deliveryRequired.length,
      responseSamples: responseSamples.length,
      providerSamples: providerCounts.size,
    },
  };
};
