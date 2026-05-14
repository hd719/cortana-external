import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,14}$/;
export const MARKET_LAB_ENVIRONMENTS = ["prod", "dev", "test", "ci"] as const;

export type MarketLabEnvironment = (typeof MARKET_LAB_ENVIRONMENTS)[number];

export type MarketLabEnvironmentHealth = {
  environment: MarketLabEnvironment;
  status: "healthy" | "unhealthy";
  url: string;
  port: number;
  runCount: number;
  latestRunAt: string | null;
  message?: string;
};

export type MarketLabEnvironmentOverview = {
  current: MarketLabEnvironment;
  sourceMode: "live" | "fixture" | "mock" | "mixed";
  isTestData: boolean;
  environments: MarketLabEnvironmentHealth[];
};

export type MarketLabCommand =
  | "list"
  | "run"
  | "show"
  | "events"
  | "settle"
  | "settle-due"
  | "codex-packet"
  | "attach-codex-review"
  | "opportunities"
  | "opportunity-show"
  | "portfolio"
  | "intent-create"
  | "intent-approve"
  | "intent-reject"
  | "intent-validate"
  | "intent-preview";

export type MarketLabRunSummary = {
  environment?: { environment?: MarketLabEnvironment; source_mode?: string; is_test_data?: boolean };
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

export type MarketLabCodexRoleReview = {
  role: "price_action" | "fundamentals" | "news_sentiment" | "risk" | "final_judge";
  stance: "bullish" | "bearish" | "neutral" | "mixed";
  confidence: number;
  summary: string;
  evidence_used: string[];
  bull_points: string[];
  bear_points: string[];
  missing_evidence: string[];
};

export type MarketLabCodexStructuredReview = {
  schema_version?: "market-lab-codex-review/v1";
  verdict: "trusted" | "uncertain" | "blocked";
  confidence: number;
  horizon: "1d" | "5d" | "20d" | "mixed";
  summary: string;
  hard_gate_assessment: string;
  context_quality: string;
  missing_context: string[];
  roles: MarketLabCodexRoleReview[];
  what_would_change_verdict: string[];
  operator_note: string;
};

export type MarketLabReview = {
  environment?: { environment?: MarketLabEnvironment; source_mode?: string; is_test_data?: boolean };
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
    structured?: MarketLabCodexStructuredReview | null;
    output_path?: string | null;
    session_id?: string | null;
  } | null;
  evidence_snapshot?: Record<string, unknown> | null;
  outcome_memory?: {
    lookback_runs?: number;
    evidence_ready_count?: number;
    needs_more_context_count?: number;
    blocked_count?: number;
    settled_count?: number;
    evidence_ready_success_rate?: number | null;
    evidence_ready_avg_alpha_vs_spy_pct?: number | null;
    common_missing_context?: string[];
    notes?: string[];
  } | null;
  token_budget?: {
    mode?: "quick" | "deep";
    estimated_input_tokens?: number | null;
    max_input_tokens?: number;
    included_sections?: string[];
    omitted_sections?: string[];
  } | null;
  sentiment_snapshot?: Record<string, unknown> | null;
  portfolio_context?: MarketLabPortfolioContext | null;
  artifact_paths?: {
    review?: string;
    events?: string;
    logs?: string;
    tradingagents?: string | null;
    codex_packet?: string | null;
    codex_review?: string | null;
    evidence_snapshot?: string | null;
    outcome_memory?: string | null;
    portfolio_context?: string | null;
  };
  settlements?: Array<Record<string, unknown>>;
  checks?: Array<{ code?: string; severity?: string; message?: string }>;
};

export type MarketLabOpportunityCandidate = {
  symbol: string;
  rank: number;
  score: number;
  score_components: Record<string, number>;
  review_label: string;
  reasons: string[];
  blockers: string[];
  missing_context: string[];
  evidence_snapshot_path?: string | null;
  outcome_memory_summary?: Record<string, unknown> | null;
};

export type MarketLabOpportunityBoard = {
  schema_version: string;
  environment?: { environment?: MarketLabEnvironment; source_mode?: string; is_test_data?: boolean };
  board_id: string;
  watchlist: string;
  generated_at: string;
  candidates: MarketLabOpportunityCandidate[];
  scoring_config: Record<string, unknown>;
  artifact_path?: string | null;
};

export type MarketLabPortfolioContext = {
  environment?: { environment?: MarketLabEnvironment; source_mode?: string; is_test_data?: boolean };
  status: "available" | "unavailable" | "reauth_required" | "error";
  source: string;
  generated_at: string;
  accounts: Array<{
    account_hash?: string;
    display_name?: string | null;
    account_type?: string | null;
    cash_value?: number | null;
    liquidation_value?: number | null;
  }>;
  positions: Array<{
    account_hash?: string | null;
    symbol?: string;
    asset_type?: string | null;
    quantity?: number | null;
    average_price?: number | null;
    current_price?: number | null;
    day_change?: number | null;
    day_change_pct?: number | null;
    quote_source?: string | null;
    quote_status?: string | null;
    quote_timestamp?: string | null;
    cost_basis?: number | null;
    unrealized_pnl?: number | null;
    market_value?: number | null;
    weight_pct?: number | null;
    sector?: string | null;
    themes?: string[];
  }>;
  exposure_notes: string[];
  overlap_notes: string[];
  message?: string | null;
  artifact_path?: string | null;
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

export const resolveMarketLabEnvironment = (): MarketLabEnvironment => {
  const raw = (process.env.MARKET_LAB_ENV || "prod").trim().toLowerCase();
  if ((MARKET_LAB_ENVIRONMENTS as readonly string[]).includes(raw)) return raw as MarketLabEnvironment;
  return "prod";
};

const sourceModeForEnvironment = (environment: MarketLabEnvironment) =>
  environment === "prod" ? "live" : environment === "ci" ? "fixture" : "mixed";

const missionControlUrlForEnvironment = (environment: MarketLabEnvironment) => {
  const port = environment === "dev" ? 3001 : 3000;
  return { port, url: `http://127.0.0.1:${port}` };
};

const resolveMarketLabDataRoot = () => {
  if (process.env.MARKET_LAB_DATA_ROOT) return path.resolve(process.env.MARKET_LAB_DATA_ROOT);
  if (process.env.MARKET_LAB_CACHE_DIR) return path.resolve(process.env.MARKET_LAB_CACHE_DIR);
  return path.resolve(resolveRepoRoot(), ".cache", "market_lab");
};

export const buildMarketLabCommand = (
  command: MarketLabCommand,
  args: string[] = [],
  environment: MarketLabEnvironment = resolveMarketLabEnvironment(),
) => ({
  file: process.env.UV_BIN || "uv",
  args: ["run", "--project", resolveMarketLabProject(), "python", "-m", "market_lab.cli", command, ...args, "--env", environment, "--json"],
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

export const runMarketLabCli = async <T>(
  command: MarketLabCommand,
  args: string[] = [],
  options: { environment?: MarketLabEnvironment } = {},
) => {
  const environment = options.environment ?? resolveMarketLabEnvironment();
  const built = buildMarketLabCommand(command, args, environment);
  try {
    const result = await execFileAsync(built.file, built.args, {
      cwd: resolveRepoRoot(),
      timeout: Number(process.env.MARKET_LAB_CLI_TIMEOUT_MS ?? 240_000),
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, MARKET_LAB_ENV: environment },
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

export const settleDueMarketLabRuns = () =>
  runMarketLabCli<{ settled_run_ids: string[] }>("settle-due");

export const getMarketLabCodexPacket = (runId: string) =>
  runMarketLabCli<{ run_id: string; packet_path: string; prompt: string }>("codex-packet", [runId]);

export const generateMarketLabOpportunities = (options: { watchlist?: string; symbols?: string[] }) => {
  const args = options.symbols?.length
    ? ["--symbols", options.symbols.join(",")]
    : ["--watchlist", options.watchlist || "core"];
  return runMarketLabCli<MarketLabOpportunityBoard>("opportunities", args);
};

export const getMarketLabOpportunityBoard = (boardId: string) =>
  runMarketLabCli<MarketLabOpportunityBoard>("opportunity-show", [boardId]);

export const getMarketLabPortfolio = () =>
  runMarketLabCli<MarketLabPortfolioContext>("portfolio", []);

export const refreshMarketLabPortfolio = () =>
  runMarketLabCli<MarketLabPortfolioContext>("portfolio", ["--refresh"]);

export const getMarketLabEnvironmentOverview = async (): Promise<MarketLabEnvironmentOverview> => {
  const current = resolveMarketLabEnvironment();
  const environments = await Promise.all(
    (["prod", "dev"] as const).map(async (environment) => {
      const { port, url } = missionControlUrlForEnvironment(environment);
      let runCount = 0;
      let latestRunAt: string | null = null;
      let message = "";
      try {
        const list = await runMarketLabCli<{ runs: MarketLabRunSummary[] }>("list", ["--limit", "100"], { environment });
        runCount = list.runs.length;
        latestRunAt = list.runs[0]?.requested_at ?? null;
      } catch (error) {
        message = error instanceof Error ? error.message : "Failed to read runs";
      }

      try {
        const response = await fetch(`${url}/api/heartbeat-status`, {
          cache: "no-store",
          signal: AbortSignal.timeout(1_000),
        });
        return {
          environment,
          status: response.ok ? ("healthy" as const) : ("unhealthy" as const),
          url,
          port,
          runCount,
          latestRunAt,
          message: response.ok ? message || undefined : `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          environment,
          status: "unhealthy" as const,
          url,
          port,
          runCount,
          latestRunAt,
          message: message || (error instanceof Error ? error.message : "Health check failed"),
        };
      }
    }),
  );
  const sourceMode = sourceModeForEnvironment(current);
  return {
    current,
    sourceMode,
    isTestData: current !== "prod",
    environments,
  };
};

export type MarketLabArtifactKind =
  | "review"
  | "events"
  | "logs"
  | "tradingagents"
  | "codex_packet"
  | "codex_review"
  | "evidence_snapshot"
  | "outcome_memory"
  | "portfolio_context";

const ARTIFACT_KINDS: readonly MarketLabArtifactKind[] = [
  "review",
  "events",
  "logs",
  "tradingagents",
  "codex_packet",
  "codex_review",
  "evidence_snapshot",
  "outcome_memory",
  "portfolio_context",
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
  const allowedRoot = resolveMarketLabDataRoot();
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
