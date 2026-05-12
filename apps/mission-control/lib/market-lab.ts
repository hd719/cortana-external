import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,14}$/;

export type MarketLabCommand =
  | "list"
  | "run"
  | "show"
  | "events"
  | "settle"
  | "settle-due"
  | "codex-packet"
  | "attach-codex-review";

export type MarketLabRunSummary = {
  run_id: string;
  symbol: string;
  requested_at: string;
  status: "queued" | "running" | "done" | "failed";
  trust_verdict?: "trusted" | "uncertain" | "blocked" | null;
  verdict_reasons: string[];
  run_dir: string;
  review_path?: string | null;
  events_path: string;
  logs_path: string;
  tradingagents_path?: string | null;
  error_message?: string | null;
};

export type MarketLabReview = {
  run_id: string;
  symbol: string;
  status: string;
  trust_verdict: "trusted" | "uncertain" | "blocked";
  verdict_reasons: string[];
  interpretation?: { summary?: string; bullish_points?: string[]; bearish_points?: string[] };
  price_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
  spy_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
  tradingagents?: { status?: string; summary?: string; output_path?: string | null };
  codex_review?: {
    status?: string;
    summary?: string;
    verdict?: "trusted" | "uncertain" | "blocked" | null;
    output_path?: string | null;
    session_id?: string | null;
  } | null;
  artifact_paths?: {
    review?: string;
    events?: string;
    logs?: string;
    tradingagents?: string | null;
    codex_packet?: string | null;
    codex_review?: string | null;
  };
  settlements?: Array<Record<string, unknown>>;
  checks?: Array<{ code?: string; severity?: string; message?: string }>;
};

type ExecError = Error & { stdout?: string | Buffer; stderr?: string | Buffer };

export const normalizeMarketLabSymbol = (symbol: string) => symbol.trim().toUpperCase();

export const isValidMarketLabSymbol = (symbol: string) => SYMBOL_RE.test(normalizeMarketLabSymbol(symbol));

const fileExists = (target: string) => {
  try {
    accessSync(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveRepoRoot = () => {
  if (process.env.MARKET_LAB_REPO_ROOT) return path.resolve(process.env.MARKET_LAB_REPO_ROOT);
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];
  const found = candidates.find((candidate) => fileExists(path.join(candidate, "market_lab", "pyproject.toml")));
  return found ?? path.resolve(process.cwd(), "../..");
};

export const resolveMarketLabProject = () => path.join(resolveRepoRoot(), "market_lab");

export const buildMarketLabCommand = (command: MarketLabCommand, args: string[] = []) => ({
  file: process.env.UV_BIN || "uv",
  args: ["run", "--project", resolveMarketLabProject(), "python", "-m", "market_lab.cli", command, ...args, "--json"],
});

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Market Lab returned non-JSON output: ${raw.slice(0, 500)}`);
  }
};

const errorDetails = (error: ExecError) => {
  const stderr = typeof error.stderr === "string" ? error.stderr : error.stderr?.toString("utf8");
  const stdout = typeof error.stdout === "string" ? error.stdout : error.stdout?.toString("utf8");
  return [stderr, stdout].filter(Boolean).join("\n").trim();
};

export const runMarketLabCli = async <T>(command: MarketLabCommand, args: string[] = []) => {
  const built = buildMarketLabCommand(command, args);
  try {
    const result = await execFileAsync(built.file, built.args, {
      cwd: resolveRepoRoot(),
      timeout: Number(process.env.MARKET_LAB_CLI_TIMEOUT_MS ?? 240_000),
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env },
    });
    return parseJson(result.stdout) as T;
  } catch (error) {
    const details = errorDetails(error as ExecError);
    const message = error instanceof Error ? error.message : "Market Lab command failed";
    throw new Error(details ? `${message}\n${details}` : message);
  }
};

export const listMarketLabRuns = (limit = 50) =>
  runMarketLabCli<{ runs: MarketLabRunSummary[] }>("list", ["--limit", String(limit)]);

export const startMarketLabRun = (symbol: string) => {
  const normalized = normalizeMarketLabSymbol(symbol);
  if (!isValidMarketLabSymbol(normalized)) {
    throw new Error("Invalid symbol");
  }
  return runMarketLabCli<{ run_id: string; symbol: string; status: string; trust_verdict?: string; review_path?: string }>("run", [normalized]);
};

export const getMarketLabRun = (runId: string) =>
  runMarketLabCli<{
    run: MarketLabRunSummary;
    review: MarketLabReview | null;
    settlements: Array<Record<string, unknown>>;
  }>("show", [runId]);

export const getMarketLabEvents = (runId: string) =>
  runMarketLabCli<Array<Record<string, unknown>>>("events", [runId]);

export const settleMarketLabRun = (runId: string) =>
  runMarketLabCli<{ run_id: string; symbol: string; settlements: Array<Record<string, unknown>> }>("settle", [runId]);

export const getMarketLabCodexPacket = (runId: string) =>
  runMarketLabCli<{ run_id: string; packet_path: string; prompt: string }>("codex-packet", [runId]);

export type MarketLabArtifactKind =
  | "review"
  | "events"
  | "logs"
  | "tradingagents"
  | "codex_packet"
  | "codex_review";

const ARTIFACT_KINDS: readonly MarketLabArtifactKind[] = [
  "review",
  "events",
  "logs",
  "tradingagents",
  "codex_packet",
  "codex_review",
];

export const isValidArtifactKind = (kind: string): kind is MarketLabArtifactKind =>
  (ARTIFACT_KINDS as readonly string[]).includes(kind);

const MAX_ARTIFACT_BYTES = 512 * 1024;

export class MarketLabArtifactMissingError extends Error {
  readonly code = "artifact_missing";
  constructor(public readonly artifactPath: string | null, message: string) {
    super(message);
    this.name = "MarketLabArtifactMissingError";
  }
}

export const readMarketLabArtifact = async (runId: string, kind: MarketLabArtifactKind) => {
  const detail = await getMarketLabRun(runId);
  const artifactPath = detail.review?.artifact_paths?.[kind] ?? null;
  if (!artifactPath) {
    throw new MarketLabArtifactMissingError(null, `No ${kind} artifact registered for this run yet.`);
  }

  const resolved = path.resolve(artifactPath);
  const allowedRoot = path.resolve(resolveRepoRoot(), ".cache", "market_lab");
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error("Artifact path is outside the Market Lab cache");
  }

  let stats;
  try {
    stats = await stat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MarketLabArtifactMissingError(resolved, "Artifact file has not been generated yet.");
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error("Artifact is not a regular file");
  }

  const buffer = await readFile(resolved);
  const truncated = buffer.byteLength > MAX_ARTIFACT_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_ARTIFACT_BYTES) : buffer;
  return {
    kind,
    path: resolved,
    contents: slice.toString("utf8"),
    size: stats.size,
    truncated,
  };
};
