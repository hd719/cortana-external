import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCortanaSourceRepo } from "@/lib/runtime-paths";
import { loadMissionControlScriptEnv } from "@/lib/script-env";

const execFileAsync = promisify(execFile);
const DEFAULT_ARTIFACT_PATH = path.join(process.env.HOME ?? "/Users/hd", ".openclaw", "reports", "autonomy-ops", "latest.json");
const REFRESH_TIMEOUT_MS = 45_000;

export type AutonomyOperatorState = "live" | "watch" | "attention";
export type AutonomySourceStatus = "fresh" | "stale" | "missing";

export type AutonomyOpsArtifact = {
  schemaVersion: "autonomy-ops.v1";
  generatedAt: string;
  freshUntil: string;
  operatorState: AutonomyOperatorState;
  posture: string;
  stale: boolean;
  counts: {
    autoRemediated: number;
    escalated: number;
    needsHuman: number;
    actionable: number;
    suppressed: number;
  };
  sections: {
    autoFixed: string[];
    degraded: string[];
    waitingOnHamel: string[];
    blockers: string[];
    familyCritical: { tracked: string[]; failures: number; stricterEscalation: boolean };
    scorecard: { counts: Record<string, number>; activeFollowUps: Array<Record<string, unknown>> };
  };
  sources: Array<{
    key: string;
    label: string;
    required: boolean;
    status: AutonomySourceStatus;
    confidence: "high" | "medium" | "low";
    generatedAt: string | null;
    freshUntil: string | null;
    detail: string | null;
  }>;
};

export type AutonomyOpsSnapshot =
  | { ok: true; stale: boolean; artifactPath: string; data: AutonomyOpsArtifact }
  | { ok: false; stale: true; artifactPath: string; error: string; staleData?: AutonomyOpsArtifact };

function artifactPath(): string {
  return process.env.AUTONOMY_OPS_ARTIFACT_PATH?.trim() || DEFAULT_ARTIFACT_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function parseAutonomyOpsArtifact(raw: string, now = new Date()): { data: AutonomyOpsArtifact; stale: boolean } {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("invalid autonomy artifact: expected object");
  if (parsed.schemaVersion !== "autonomy-ops.v1") throw new Error("invalid autonomy artifact schemaVersion");
  const generatedAt = String(parsed.generatedAt ?? "");
  const freshUntil = String(parsed.freshUntil ?? "");
  const operatorState = String(parsed.operatorState ?? "");
  if (!["live", "watch", "attention"].includes(operatorState)) throw new Error("invalid autonomy artifact operatorState");
  if (Number.isNaN(Date.parse(generatedAt)) || Number.isNaN(Date.parse(freshUntil))) {
    throw new Error("invalid autonomy artifact freshness metadata");
  }
  const counts = isRecord(parsed.counts) ? parsed.counts : {};
  const sections = isRecord(parsed.sections) ? parsed.sections : {};
  const familyCritical = isRecord(sections.familyCritical) ? sections.familyCritical : {};
  const scorecard = isRecord(sections.scorecard) ? sections.scorecard : {};
  const sources = Array.isArray(parsed.sources) ? parsed.sources.filter(isRecord).map((source) => ({
    key: String(source.key ?? "unknown"),
    label: String(source.label ?? source.key ?? "Unknown"),
    required: Boolean(source.required),
    status: ["fresh", "stale", "missing"].includes(String(source.status)) ? String(source.status) as AutonomySourceStatus : "missing",
    confidence: ["high", "medium", "low"].includes(String(source.confidence)) ? String(source.confidence) as "high" | "medium" | "low" : "low",
    generatedAt: source.generatedAt == null ? null : String(source.generatedAt),
    freshUntil: source.freshUntil == null ? null : String(source.freshUntil),
    detail: source.detail == null ? null : String(source.detail),
  })) : [];
  if (!sources.length) throw new Error("invalid autonomy artifact sources");
  if (sources.some((source) => source.required && source.status !== "fresh") && operatorState === "live") {
    throw new Error("invalid autonomy artifact: live state with stale required source");
  }
  const data: AutonomyOpsArtifact = {
    schemaVersion: "autonomy-ops.v1",
    generatedAt,
    freshUntil,
    operatorState: operatorState as AutonomyOperatorState,
    posture: String(parsed.posture ?? "unknown"),
    stale: Boolean(parsed.stale) || Date.parse(freshUntil) <= now.getTime(),
    counts: {
      autoRemediated: Number(counts.autoRemediated ?? 0),
      escalated: Number(counts.escalated ?? 0),
      needsHuman: Number(counts.needsHuman ?? 0),
      actionable: Number(counts.actionable ?? 0),
      suppressed: Number(counts.suppressed ?? 0),
    },
    sections: {
      autoFixed: asStringArray(sections.autoFixed),
      degraded: asStringArray(sections.degraded),
      waitingOnHamel: asStringArray(sections.waitingOnHamel),
      blockers: asStringArray(sections.blockers),
      familyCritical: {
        tracked: asStringArray(familyCritical.tracked),
        failures: Number(familyCritical.failures ?? 0),
        stricterEscalation: Boolean(familyCritical.stricterEscalation ?? true),
      },
      scorecard: {
        counts: isRecord(scorecard.counts) ? Object.fromEntries(Object.entries(scorecard.counts).map(([key, value]) => [key, Number(value ?? 0)])) : {},
        activeFollowUps: Array.isArray(scorecard.activeFollowUps) ? scorecard.activeFollowUps.filter(isRecord) : [],
      },
    },
    sources,
  };
  return { data, stale: data.stale };
}

export function getAutonomyOpsSnapshot(now = new Date()): AutonomyOpsSnapshot {
  const filePath = artifactPath();
  try {
    const parsed = parseAutonomyOpsArtifact(fs.readFileSync(filePath, "utf8"), now);
    return { ok: true, stale: parsed.stale, artifactPath: filePath, data: parsed.data };
  } catch (error) {
    return {
      ok: false,
      stale: true,
      artifactPath: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshAutonomyOpsArtifact(): Promise<AutonomyOpsSnapshot> {
  const repo = getCortanaSourceRepo();
  await execFileAsync("npx", ["tsx", path.join(repo, "tools", "monitoring", "write-autonomy-ops-artifact.ts")], {
    cwd: repo,
    timeout: REFRESH_TIMEOUT_MS,
    env: loadMissionControlScriptEnv(undefined, process.env),
  });
  return getAutonomyOpsSnapshot();
}
