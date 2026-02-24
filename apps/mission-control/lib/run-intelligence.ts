import { Prisma, Run } from "@prisma/client";

export type EvidenceGrade = "high" | "medium" | "low";

export type LaunchPhase =
  | "phase1_queued"
  | "phase2_running_confirmed"
  | "phase2_running_unconfirmed"
  | "terminal";

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const getNested = (value: unknown, path: string[]): unknown => {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const pickString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

export const extractProviderPath = (payload: Prisma.JsonValue | null | undefined) => {
  const record = asObject(payload);

  const provider =
    pickString(record.provider) ??
    pickString(record.providerPath) ??
    pickString(getNested(record, ["outcome", "provider"])) ??
    pickString(getNested(record, ["model", "provider"])) ??
    "unknown";

  const model =
    pickString(record.model) ??
    pickString(getNested(record, ["outcome", "model"])) ??
    pickString(getNested(record, ["model", "name"])) ??
    "unknown";

  const auth =
    pickString(record.authPath) ??
    pickString(record.auth) ??
    pickString(getNested(record, ["outcome", "auth"])) ??
    pickString(getNested(record, ["auth", "mode"])) ??
    "unknown";

  const fallback =
    record.fallbackUsed === true ||
    record.usedFallback === true ||
    pickString(record.path) === "fallback" ||
    pickString(getNested(record, ["outcome", "path"])) === "fallback";

  return {
    provider,
    model,
    auth,
    fallback,
    label: `${provider} / ${model} / auth:${auth}`,
  };
};

export const deriveLaunchPhase = (run: Pick<Run, "externalStatus" | "completedAt">): LaunchPhase => {
  const status = (run.externalStatus || "").toLowerCase();
  if (["done", "failed", "timeout", "killed"].includes(status) || !!run.completedAt) {
    return "terminal";
  }
  if (status === "queued") return "phase1_queued";
  if (status === "running") return "phase2_running_confirmed";
  return "phase2_running_unconfirmed";
};

export const deriveEvidenceGrade = (run: Pick<Run, "externalStatus" | "completedAt" | "payload" | "summary">): EvidenceGrade => {
  const status = (run.externalStatus || "").toLowerCase();
  const payload = asObject(run.payload);
  const source = pickString(payload.source) || "";
  const hasOutcome = !!getNested(payload, ["outcome"]);
  const hasReason = typeof run.summary === "string" && run.summary.length > 10;

  if (["done", "failed", "timeout", "killed"].includes(status) && (hasOutcome || !!run.completedAt)) {
    return "high";
  }

  if (status === "running" && (source.includes("openclaw") || hasReason)) {
    return "medium";
  }

  if (status === "queued" && source.includes("openclaw")) {
    return "medium";
  }

  return "low";
};
