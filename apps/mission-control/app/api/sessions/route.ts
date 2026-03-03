import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const EXEC_OPTIONS: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 15000,
  stdio: ["ignore", "pipe", "pipe"],
};

const DEFAULT_MINUTES = 1440;

type ExecError = Error & { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };

type RawSession = Record<string, unknown>;

type NormalizedSession = {
  key: string | null;
  sessionId: string | null;
  updatedAt: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  agentId: string | null;
  systemSent: boolean | null;
  abortedLastRun: boolean | null;
  estimatedCost: number;
};

const runOpenclaw = (command: string) => execSync(command, EXEC_OPTIONS).trim();

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return null;
};

const toStringValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const toBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  return null;
};

const getSessionList = (payload: unknown): RawSession[] => {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const sessions = record.sessions;
  return Array.isArray(sessions) ? (sessions as RawSession[]) : [];
};

const getModelFamily = (model: string) => {
  const lower = model.toLowerCase();
  if (lower.includes("gpt-5.1")) return "gpt-5.1";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("codex")) return "codex";
  return "unknown";
};

const RATE_TABLE: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  codex: { input: 2, output: 8 },
  "gpt-5.1": { input: 1, output: 4 },
};

const getCostTokens = (session: {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}) => {
  const totalTokens = session.totalTokens;
  let costInput = session.inputTokens;
  let costOutput = session.outputTokens;

  if (costInput === null && costOutput === null) {
    if (totalTokens !== null) {
      costInput = totalTokens / 2;
      costOutput = totalTokens / 2;
    } else {
      costInput = 0;
      costOutput = 0;
    }
  } else if (costInput === null && costOutput !== null) {
    costInput = totalTokens !== null ? Math.max(totalTokens - costOutput, 0) : 0;
  } else if (costInput !== null && costOutput === null) {
    costOutput = totalTokens !== null ? Math.max(totalTokens - costInput, 0) : 0;
  }

  return {
    costInputTokens: costInput ?? 0,
    costOutputTokens: costOutput ?? 0,
  };
};

const estimateCost = (model: string | null, inputTokens: number, outputTokens: number) => {
  if (!model) return 0;
  const family = getModelFamily(model);
  const rates = RATE_TABLE[family];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
};

const normalizeSession = (session: RawSession): NormalizedSession => {
  const totalTokens = toNumber(session.totalTokens ?? session.total_tokens);
  const inputTokens = toNumber(session.inputTokens ?? session.input_tokens);
  const outputTokens = toNumber(session.outputTokens ?? session.output_tokens);
  const model = toStringValue(session.model ?? session.modelOverride ?? session.model_override);
  const { costInputTokens, costOutputTokens } = getCostTokens({
    totalTokens,
    inputTokens,
    outputTokens,
  });

  return {
    key: toStringValue(session.key ?? session.sessionKey ?? session.id),
    sessionId: toStringValue(session.sessionId ?? session.id),
    updatedAt: toTimestamp(session.updatedAt ?? session.updated_at ?? session.lastUpdatedAt),
    totalTokens,
    inputTokens,
    outputTokens,
    model,
    agentId: toStringValue(session.agentId ?? session.agent_id),
    systemSent: toBoolean(session.systemSent ?? session.system_sent),
    abortedLastRun: toBoolean(session.abortedLastRun ?? session.aborted_last_run),
    estimatedCost: estimateCost(model, costInputTokens, costOutputTokens),
  };
};

const getExecDetails = (error: ExecError) => {
  const detail = error.stderr ?? error.stdout;
  if (!detail) return undefined;
  if (typeof detail === "string") return detail.trim();
  return detail.toString("utf8").trim();
};

const errorResponse = (error: unknown, fallback: string, status = 500) => {
  const message = error instanceof Error ? error.message : fallback;
  const details = error instanceof Error ? getExecDetails(error as ExecError) : undefined;
  return NextResponse.json({ error: message, details }, { status });
};

const parseMinutes = (value: string | null) => {
  if (!value) return DEFAULT_MINUTES;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MINUTES;
  return Math.floor(parsed);
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minutes = parseMinutes(searchParams.get("minutes"));

  try {
    const raw = runOpenclaw(`openclaw sessions --json --all-agents --active ${minutes}`);
    const parsed = parseJson(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse OpenClaw response", details: raw || undefined },
        { status: 502 }
      );
    }

    const sessions = getSessionList(parsed).map(normalizeSession);
    return NextResponse.json({ sessions });
  } catch (error) {
    return errorResponse(error, "Failed to list sessions");
  }
}
