"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Beaker,
  CheckCircle2,
  FileJson2,
  MessageSquareText,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunSummary = {
  run_id: string;
  symbol: string;
  requested_at: string;
  status: string;
  trust_verdict?: "trusted" | "uncertain" | "blocked" | null;
  verdict_reasons: string[];
};

type Settlement = Record<string, unknown> & {
  window?: string;
  status?: string;
  alpha_vs_spy_pct?: number;
  raw_return_pct?: number;
  return_pct?: number;
};

type TimelineEvent = {
  event?: string;
  message?: string;
  timestamp?: string;
};

type SentimentSource = {
  source?: string;
  status?: string;
  sample_count?: number;
  fetch_method?: string;
  error_message?: string | null;
  summary?: string | null;
  samples?: string[];
};

type CodexRoleReview = {
  role: "price_action" | "fundamentals" | "news_sentiment" | "risk" | "final_judge";
  stance: "bullish" | "bearish" | "neutral" | "mixed";
  confidence: number;
  summary: string;
  evidence_used: string[];
  bull_points: string[];
  bear_points: string[];
  missing_evidence: string[];
};

type CodexStructuredReview = {
  schema_version?: "market-lab-codex-review/v1";
  verdict: "trusted" | "uncertain" | "blocked";
  confidence: number;
  horizon: "1d" | "5d" | "20d" | "mixed";
  summary: string;
  hard_gate_assessment: string;
  context_quality: string;
  missing_context: string[];
  roles: CodexRoleReview[];
  what_would_change_verdict: string[];
  operator_note: string;
};

type PortfolioContext = {
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
  }>;
  exposure_notes: string[];
  overlap_notes: string[];
  message?: string | null;
};

type EnvironmentOverview = {
  current: "prod" | "dev" | "test" | "ci";
  sourceMode: "live" | "fixture" | "mock" | "mixed";
  isTestData: boolean;
  environments: Array<{
    environment: "prod" | "dev" | "test" | "ci";
    status: "healthy" | "unhealthy";
    url: string;
    port: number;
    runCount: number;
    latestRunAt: string | null;
    message?: string;
  }>;
};

type RunDetail = {
  run: RunSummary;
  review: {
    trust_verdict: "trusted" | "uncertain" | "blocked";
    verdict_reasons: string[];
    interpretation?: { summary?: string; bullish_points?: string[]; bearish_points?: string[] };
    price_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    spy_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    codex_review?: {
      status?: string;
      summary?: string;
      verdict?: "trusted" | "uncertain" | "blocked" | null;
      structured?: CodexStructuredReview | null;
      output_path?: string | null;
      session_id?: string | null;
    } | null;
    evidence_snapshot?: { missing_context?: string[]; risk_flags?: string[] } | null;
    outcome_memory?: {
      lookback_runs?: number;
      evidence_ready_count?: number;
      settled_count?: number;
      evidence_ready_success_rate?: number | null;
      evidence_ready_avg_alpha_vs_spy_pct?: number | null;
      notes?: string[];
    } | null;
    token_budget?: {
      mode?: "quick" | "deep";
      estimated_input_tokens?: number | null;
      max_input_tokens?: number;
      included_sections?: string[];
      omitted_sections?: string[];
    } | null;
    sentiment_snapshot?: { status?: string; missing_sources?: string[]; sources?: SentimentSource[] } | null;
    portfolio_context?: PortfolioContext | null;
    artifact_paths?: {
      review?: string;
      events?: string;
      logs?: string;
      codex_packet?: string | null;
      codex_review?: string | null;
      evidence_snapshot?: string | null;
      outcome_memory?: string | null;
      portfolio_context?: string | null;
    };
    checks?: Array<{ code?: string; severity?: string; message?: string }>;
    settlements?: Settlement[];
  } | null;
  settlements: Settlement[];
};

type CodexReviewStartResponse = {
  status?: "running" | "already_attached";
  streamId?: string;
  packet_path?: string | null;
  reused?: boolean;
};

type Verdict = "trusted" | "uncertain" | "blocked";

type TapeMode = "recent" | "symbol" | "verdict";

const verdictMeta: Record<Verdict, {
  label: string;
  code: string;
  icon: LucideIcon;
  dot: string;
  accent: string;
  rail: string;
  chip: string;
  ribbon: string;
}> = {
  trusted: {
    label: "Evidence Ready",
    code: "OK",
    icon: ShieldCheck,
    dot: "bg-emerald-500 dark:bg-emerald-400",
    accent: "text-emerald-600 dark:text-emerald-400",
    rail: "border-l-emerald-500 dark:border-l-emerald-400",
    chip: "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ribbon: "border-emerald-500/40 bg-emerald-500/[0.04]",
  },
  uncertain: {
    label: "Needs More Context",
    code: "??",
    icon: ShieldQuestion,
    dot: "bg-amber-500 dark:bg-amber-400",
    accent: "text-amber-600 dark:text-amber-400",
    rail: "border-l-amber-500 dark:border-l-amber-400",
    chip: "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ribbon: "border-amber-500/40 bg-amber-500/[0.04]",
  },
  blocked: {
    label: "Blocked",
    code: "!!",
    icon: ShieldAlert,
    dot: "bg-red-500 dark:bg-red-400",
    accent: "text-red-600 dark:text-red-400",
    rail: "border-l-red-500 dark:border-l-red-400",
    chip: "border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-400",
    ribbon: "border-red-500/40 bg-red-500/[0.04]",
  },
};

const severityChip = (severity?: string, code?: string) => {
  const isBlocker = severity === "blocker";
  const isWarning = severity === "warning" || (!isBlocker && code?.includes("missing"));
  if (isBlocker) return { label: severity ?? "BLK", cls: "border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-400" };
  if (isWarning) return { label: (severity ?? "warn").toUpperCase(), cls: "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400" };
  return { label: (severity ?? "info").toUpperCase(), cls: "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
};

const isPortfolioAvailable = (context?: PortfolioContext | null) => context?.status?.toLowerCase() === "available";

const hasCodexReviewOutput = (review?: RunDetail["review"]) =>
  Boolean(
    review?.codex_review?.structured ||
      review?.codex_review?.summary ||
      review?.codex_review?.output_path ||
      review?.codex_review?.status === "attached",
  );

const asMoney = (value?: number) =>
  typeof value === "number" ? `$${value.toFixed(2)}` : "—";

const asPercent = (value?: number) =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "—";

const asSignedPercent = (value?: number | null) =>
  typeof value === "number" ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";

const asSignedMoney = (value?: number | null) =>
  typeof value === "number" ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}` : "—";

const asShares = (value?: number | null) =>
  typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";

const percentMove = (current?: number | null, basis?: number | null) => {
  if (typeof current !== "number" || typeof basis !== "number" || basis === 0) return null;
  return ((current - basis) / basis) * 100;
};

const roleLabel = (role: CodexRoleReview["role"]) =>
  ({
    price_action: "Price action",
    fundamentals: "Fundamentals",
    news_sentiment: "News and sentiment",
    risk: "Risk",
    final_judge: "Final judge",
  })[role];

const formatRunTime = (iso?: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatEventTitle = (value?: string) =>
  String(value ?? "event").replace(/_/g, " ");

const sourceLabel = (source?: string) =>
  ({
    yahoo_finance_news: "Yahoo news",
    stocktwits: "StockTwits",
    reddit: "Reddit",
  })[String(source ?? "")] ?? String(source ?? "source");

// Brand-ish colors so feed rows and filter chips are easy to scan at a glance.
const sourceColorClass = (source?: string) => {
  switch (String(source ?? "")) {
    case "yahoo_finance_news":
      return "text-purple-600 dark:text-purple-400";
    case "stocktwits":
      return "text-blue-600 dark:text-blue-400";
    case "reddit":
      return "text-orange-600 dark:text-orange-400";
    default:
      return "text-muted-foreground/80";
  }
};

const splitSourceSummary = (summary?: string | null, limit = 5) =>
  String(summary ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);

const sourceSamples = (source: SentimentSource, limit = 5) => {
  const samples = Array.isArray(source.samples) ? source.samples.filter(Boolean) : [];
  return (samples.length ? samples : splitSourceSummary(source.summary, limit)).slice(0, limit);
};

const statusChipClass = (status?: string) => {
  if (status === "available" || status === "ok") return "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status === "partial" || status === "empty" || status === "rate_limited") return "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (status === "error") return "border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-400";
  return "border-border/60 bg-muted/40 text-muted-foreground";
};

const stanceChipClass = (stance?: string) => {
  const s = String(stance ?? "").toLowerCase();
  if (s === "bullish" || s === "bull") return "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (s === "bearish" || s === "bear") return "border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-400";
  return "border-border/60 bg-muted/40 text-muted-foreground";
};

type SentimentLabel = "bull" | "bear" | null;

const deriveSentiment = (item: string): { label: SentimentLabel; cleaned: string } => {
  const match = String(item).match(/^(bullish|bearish):\s*/i);
  if (!match) return { label: null, cleaned: String(item) };
  const label = match[1].toLowerCase() === "bullish" ? "bull" : "bear";
  return { label, cleaned: String(item).slice(match[0].length) };
};

const getAge = (iso?: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
};

const formatWindow = (window?: string) => String(window ?? "").toUpperCase();

const settlementReturn = (settlement: Settlement) =>
  typeof settlement.raw_return_pct === "number" ? settlement.raw_return_pct : settlement.return_pct;

const describeSettlementResult = (settlements: Settlement[]) => {
  const settled = settlements.filter((settlement) => settlement.status === "settled");
  const waiting = settlements.filter((settlement) => settlement.status === "pending" || settlement.status === "not_due");
  const failed = settlements.filter((settlement) => settlement.status === "failed");

  if (settled.length === 0 && waiting.length > 0 && failed.length === 0) {
    return `No settlement windows are due yet. ${waiting.map((item) => formatWindow(item.window)).join(", ")} still waiting.`;
  }
  const pieces: string[] = [];
  if (settled.length > 0) {
    pieces.push(`Settled ${settled.map((item) => formatWindow(item.window)).join(", ")}.`);
  }
  if (waiting.length > 0) {
    pieces.push(`${waiting.map((item) => formatWindow(item.window)).join(", ")} still waiting.`);
  }
  if (failed.length > 0) {
    pieces.push(`${failed.map((item) => formatWindow(item.window)).join(", ")} failed.`);
  }
  return pieces.join(" ");
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok || body.status === "error") {
    throw new Error(body.error ?? "Market Lab request failed");
  }
  return body.data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseCodexSseChunk(rawChunk: string): { event: string; data: unknown } | null {
  const lines = rawChunk.replace(/\r/g, "").split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function getCodexStreamError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : null;
}

function getLifecycleSessionId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const sessionId = data.codexSessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function getThreadStartedId(data: unknown): string | null {
  if (!isRecord(data) || data.type !== "thread.started") return null;
  const threadId = data.thread_id;
  return typeof threadId === "string" && threadId.trim() ? threadId : null;
}

function getDoneSessionId(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.session)) return null;
  const sessionId = data.session.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function getCodexProgressMessage(data: unknown): string | null {
  if (!isRecord(data) || data.type !== "item.completed" || !isRecord(data.item)) return null;
  if (data.item.type === "agent_message") return "Codex responded; waiting for the attach command to finish.";
  if (data.item.type === "function_call_output") return "Codex ran the attach command; refreshing this run.";
  return null;
}

async function consumeCodexReviewStream(
  response: Response,
  callbacks: {
    onSession: (sessionId: string) => void;
    onProgress: (message: string) => void;
    onDone: (sessionId: string | null) => void;
  },
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Codex stream response did not include a body");

  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let latestSessionId: string | null = null;

  const handleChunk = async (rawChunk: string) => {
    const envelope = parseCodexSseChunk(rawChunk);
    if (!envelope) return;

    if (envelope.event === "codex_event") {
      const threadId = getThreadStartedId(envelope.data);
      if (threadId) {
        latestSessionId = threadId;
        callbacks.onSession(threadId);
        return;
      }

      const progress = getCodexProgressMessage(envelope.data);
      if (progress) callbacks.onProgress(progress);
      return;
    }

    if (envelope.event === "lifecycle") {
      const sessionId = getLifecycleSessionId(envelope.data);
      if (sessionId) {
        latestSessionId = sessionId;
        callbacks.onSession(sessionId);
      }
      return;
    }

    if (envelope.event === "error") {
      throw new Error(getCodexStreamError(envelope.data) ?? "Codex stream failed");
    }

    if (envelope.event === "done") {
      latestSessionId = getDoneSessionId(envelope.data) ?? latestSessionId;
      completed = true;
      callbacks.onDone(latestSessionId);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawChunk = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await handleChunk(rawChunk);
      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) await handleChunk(buffer);
  if (!completed) throw new Error("Codex stream ended before the session finished");
}

type MarketLabClientProps = {
  embedded?: boolean;
};

type PortfolioNotice = {
  message: string;
  tone: "success" | "warning";
};

type CodexReviewNoticeState = {
  tone: "running" | "ready" | "missing";
  title: string;
  message: string;
  sessionId?: string | null;
};

export function MarketLabClient({ embedded = false }: MarketLabClientProps = {}) {
  const [symbol, setSymbol] = useState("AAPL");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [latestPortfolio, setLatestPortfolio] = useState<PortfolioContext | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<string | null>(null);
  const [codexStatusSessionId, setCodexStatusSessionId] = useState<string | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<string | null>(null);
  const [portfolioStatus, setPortfolioStatus] = useState<PortfolioNotice | null>(null);
  const [environmentOverview, setEnvironmentOverview] = useState<EnvironmentOverview | null>(null);
  const [tapeMode, setTapeMode] = useState<TapeMode>("recent");
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [pinnedStep, setPinnedStep] = useState<number | null>(null);
  const activePillRef = useRef<HTMLButtonElement | null>(null);
  const [feedSrc, setFeedSrc] = useState<string>("all");
  const [feedSent, setFeedSent] = useState<"all" | "bull" | "bear" | "unlabeled">("all");
  const [codexExpanded, setCodexExpanded] = useState(false);
  const [tapeOpen, setTapeOpen] = useState(false);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const codexRequestInFlightRef = useRef<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  // Adaptive Run Tape: sidebar earns its column at 6+ runs; below that, render a horizontal strip at the top of the decision area on lg+.
  const showRunTapeSidebar = runs.length > 5;

  const symbolHistory = useMemo(() => {
    const symbol = selectedRun?.symbol;
    if (!symbol) return [] as RunSummary[];
    return runs.filter((run) => run.symbol === symbol).slice(0, 8);
  }, [runs, selectedRun?.symbol]);

  const runsBySymbol = useMemo(() => {
    const groups = new Map<string, RunSummary[]>();
    for (const run of runs) {
      const existing = groups.get(run.symbol);
      if (existing) {
        existing.push(run);
      } else {
        groups.set(run.symbol, [run]);
      }
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const aLatest = a[1][0]?.requested_at ?? "";
      const bLatest = b[1][0]?.requested_at ?? "";
      return bLatest.localeCompare(aLatest);
    });
  }, [runs]);

  const runsByVerdict = useMemo(() => {
    const buckets: Record<Verdict, RunSummary[]> = {
      trusted: [],
      uncertain: [],
      blocked: [],
    };
    for (const run of runs) {
      const verdict = (run.trust_verdict ?? "uncertain") as Verdict;
      buckets[verdict].push(run);
    }
    return buckets;
  }, [runs]);

  const toggleGroup = (key: string, isOpen: boolean) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadRuns = async () => {
    const data = await api<{ runs: RunSummary[] }>("/api/market-lab/runs?limit=25");
    setRuns(data.runs);
    setSelectedRunId((current) => current ?? data.runs[0]?.run_id ?? null);
  };

  const loadLatestPortfolio = async () => {
    const portfolio = await api<PortfolioContext>("/api/market-lab/portfolio/latest");
    setLatestPortfolio(portfolio.status === "available" ? portfolio : null);
  };

  const loadEnvironmentOverview = async () => {
    const overview = await api<Partial<EnvironmentOverview>>("/api/market-lab/environments");
    setEnvironmentOverview(Array.isArray(overview.environments) ? (overview as EnvironmentOverview) : null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      await loadRuns();
      await loadLatestPortfolio();
      await loadEnvironmentOverview();
      if (selectedRunId) {
        await loadRunDetail(selectedRunId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const loadRunDetail = async (runId: string) => {
    const [runDetail, eventItems] = await Promise.all([
      api<RunDetail>(`/api/market-lab/runs/${encodeURIComponent(runId)}`),
      api<TimelineEvent[]>(`/api/market-lab/runs/${encodeURIComponent(runId)}/events`),
    ]);
    setDetail(runDetail);
    setEvents(eventItems);
    return runDetail;
  };

  useEffect(() => {
    loadRuns().catch((err: Error) => setError(err.message));
    loadLatestPortfolio().catch(() => {
      setLatestPortfolio(null);
    });
    loadEnvironmentOverview().catch(() => {
      setEnvironmentOverview(null);
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    loadRunDetail(selectedRunId).catch((err: Error) => setError(err.message));
    setPinnedStep(null);
  }, [selectedRunId]);

  useEffect(() => {
    if (typeof activePillRef.current?.scrollIntoView === "function") {
      activePillRef.current.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    }
  }, [events.length]);

  const startRun = async () => {
    setLoading(true);
    setError(null);
    setCodexStatus(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      const result = await api<{ run_id: string }>("/api/market-lab/runs", {
        method: "POST",
        body: JSON.stringify({ symbol }),
      });
      await loadRuns();
      setSelectedRunId(result.run_id);
      await loadRunDetail(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setLoading(false);
    }
  };

  const settleRun = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      const result = await api<{ settlements: Settlement[] }>(
        `/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/settle`,
        { method: "POST" },
      );
      setSettlementStatus(describeSettlementResult(result.settlements ?? []));
      await loadRunDetail(selectedRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle run");
    } finally {
      setLoading(false);
    }
  };

  const settleDue = async () => {
    setLoading(true);
    setError(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      const result = await api<{ settled_run_ids: string[] }>("/api/market-lab/settle-due", { method: "POST" });
      const count = result.settled_run_ids?.length ?? 0;
      setSettlementStatus(count === 0 ? "Settle due checked: no due windows right now." : `Settle due updated ${count} run${count === 1 ? "" : "s"}.`);
      await loadRuns();
      if (selectedRunId) {
        await loadRunDetail(selectedRunId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle due windows");
    } finally {
      setLoading(false);
    }
  };

  const askCodex = async () => {
    if (!selectedRunId) return;
    const runId = selectedRunId;
    if (codexRequestInFlightRef.current === runId) {
      setCodexStatus("Codex review is already running for this Market Lab run.");
      return;
    }
    codexRequestInFlightRef.current = runId;
    setLoading(true);
    setError(null);
    setCodexStatus("Codex review queued. Waiting for the session to start...");
    setCodexStatusSessionId(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      const result = await api<CodexReviewStartResponse>(
        `/api/market-lab/runs/${encodeURIComponent(runId)}/codex-review`,
        { method: "POST" },
      );
      if (result.status === "already_attached" || !result.streamId) {
        await loadRunDetail(runId);
        await loadRuns();
        setCodexStatus("Codex review is already attached. The review panel is up to date.");
        return;
      }

      setCodexStatus(
        result.reused
          ? "Codex review is already running for this Market Lab run. Watching the existing stream..."
          : `Codex stream started: ${result.streamId}. Waiting for Codex to attach the review...`,
      );

      const response = await fetch(`/api/codex/streams/${encodeURIComponent(result.streamId)}`, {
        headers: { Accept: "text/event-stream" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to attach to Codex stream");
      }

      await consumeCodexReviewStream(response, {
        onSession(sessionId) {
          setCodexStatusSessionId(sessionId);
          setCodexStatus(`Codex session started: ${sessionId}. Review is running...`);
        },
        onProgress(message) {
          setCodexStatus(message);
        },
        onDone(sessionId) {
          setCodexStatusSessionId(sessionId);
          setCodexStatus("Codex review attached. Refreshing Market Lab...");
        },
      });
      await loadRunDetail(runId);
      await loadRuns();
      setCodexStatus("Codex review attached. The review panel is up to date.");
    } catch (err) {
      try {
        const refreshed = await loadRunDetail(runId);
        await loadRuns();
        if (refreshed.review?.codex_review?.status === "attached") {
          setCodexStatus("Codex review attached. Session transcript is not indexed yet, so use the review panel for now.");
          return;
        }
      } catch {
        // Preserve the original stream/start error below.
      }
      setError(err instanceof Error ? err.message : "Failed to start Codex review");
    } finally {
      if (codexRequestInFlightRef.current === runId) {
        codexRequestInFlightRef.current = null;
      }
      setLoading(false);
    }
  };

  const refreshPortfolio = async () => {
    setLoading(true);
    setError(null);
    setPortfolioStatus(null);
    try {
      const result = await api<PortfolioContext>("/api/market-lab/portfolio/refresh", { method: "POST" });
      setLatestPortfolio(result.status === "available" ? result : null);
      if (result.status === "available") {
        setPortfolioStatus({
          message: "Schwab portfolio cache refreshed. New Market Lab runs will attach the latest read-only context.",
          tone: "success",
        });
      } else if (result.status === "reauth_required") {
        setPortfolioStatus({
          message: "Schwab OAuth is refreshed, but account/position access is not authorized for this app yet.",
          tone: "warning",
        });
      } else {
        setPortfolioStatus({
          message: result.message ?? "Schwab portfolio context is not available yet.",
          tone: "warning",
        });
      }
      if (selectedRunId) {
        await loadRunDetail(selectedRunId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh portfolio context");
    } finally {
      setLoading(false);
    }
  };

  const review = detail?.review;
  const structuredCodex = review?.codex_review?.structured ?? null;
  const verdict: Verdict = (review?.trust_verdict ?? selectedRun?.trust_verdict ?? "uncertain") as Verdict;
  const meta = verdictMeta[verdict];
  const VerdictIcon = meta.icon;
  const selectedSymbol = selectedRun?.symbol ?? symbol;
  const checks = review?.checks ?? [];
  const settlements = review?.settlements?.length ? review.settlements : detail?.settlements ?? [];
  const settlementWindows = ["1d", "5d", "20d"].map((window) => {
    const found = settlements.find((settlement) => String(settlement.window).toLowerCase() === window);
    return found ?? { window, status: "pending" };
  });

  const priceSource = review?.price_facts?.source;
  const priceBasis = review?.price_facts?.price_basis;
  const spySource = review?.spy_facts?.source;
  const codexState = structuredCodex?.verdict ?? review?.codex_review?.verdict ?? review?.codex_review?.status ?? "not requested";
  const codexOutputAttached = hasCodexReviewOutput(review);
  const codexReviewNotice = useMemo<CodexReviewNoticeState | null>(() => {
    const sessionId = codexStatusSessionId ?? review?.codex_review?.session_id ?? null;
    if (codexStatus) {
      const statusLooksReady = codexOutputAttached || codexStatus.toLowerCase().includes("attached");
      return {
        tone: statusLooksReady ? "ready" : "running",
        title: statusLooksReady ? "Codex review ready" : "Codex is reviewing",
        message: codexStatus,
        sessionId,
      };
    }

    if (codexOutputAttached) {
      return {
        tone: "ready",
        title: "Codex review ready",
        message: "Second opinion is attached below.",
        sessionId,
      };
    }

    if (review) {
      return {
        tone: "missing",
        title: "Codex review not attached",
        message: "Ask Codex to attach the second opinion before treating this run as fully reviewed.",
      };
    }

    return null;
  }, [codexOutputAttached, codexStatus, codexStatusSessionId, review]);
  const heroSummary =
    verdict === "trusted"
      ? codexOutputAttached
        ? "Evidence gates passed. Codex second opinion is attached below."
        : "Evidence gates passed. Codex second opinion has not been attached yet."
      : review?.interpretation?.summary ?? "Select or run a review to see the trust decision.";
  const tokenBudget = review?.token_budget;
  const outcomeMemory = review?.outcome_memory;
  const runPortfolioContext = review?.portfolio_context ?? null;
  const usingPortfolioFallback = isPortfolioAvailable(latestPortfolio) && !isPortfolioAvailable(runPortfolioContext);
  const portfolioContext = usingPortfolioFallback ? latestPortfolio : runPortfolioContext ?? latestPortfolio;
  const selectedPosition = portfolioContext?.positions?.find((position) => position.symbol === selectedSymbol) ?? null;
  const currentVsRun = percentMove(selectedPosition?.current_price, review?.price_facts?.price);
  const currentVsAverage = percentMove(selectedPosition?.current_price, selectedPosition?.average_price);
  const sentiment = review?.sentiment_snapshot ?? null;
  const newsRole = structuredCodex?.roles.find((role) => role.role === "news_sentiment") ?? null;
  // Per-headline sentiment label derived via tier-2 self-label only (e.g. StockTwits "Bullish:"/"Bearish:" prefix).
  // TODO: per-headline labels once Codex news_sentiment role surfaces them; substring-matching its summary points is too lossy.
  const sentimentDigest = (sentiment?.sources ?? []).flatMap((source) =>
    sourceSamples(source, 20).map((item) => {
      const { label, cleaned } = deriveSentiment(item);
      return {
        source: source.source,
        status: source.status,
        item: cleaned,
        sentiment: label,
      };
    }),
  );
  const sentimentCounts = sentimentDigest.reduce(
    (acc, entry) => {
      if (entry.sentiment === "bull") acc.bull += 1;
      else if (entry.sentiment === "bear") acc.bear += 1;
      else acc.unlabeled += 1;
      return acc;
    },
    { bull: 0, bear: 0, unlabeled: 0 },
  );
  const labeledTotal = sentimentCounts.bull + sentimentCounts.bear;
  const filteredFeed = sentimentDigest.filter((entry) => {
    if (feedSrc !== "all" && entry.source !== feedSrc) return false;
    if (feedSent === "all") return true;
    if (feedSent === "unlabeled") return entry.sentiment === null;
    return entry.sentiment === feedSent;
  });
  const sourceCounts = sentimentDigest.reduce(
    (acc, entry) => {
      const key = String(entry.source ?? "other");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const latestEvent = events.at(-1);
  const shownEvent = pinnedStep !== null ? events[pinnedStep] : latestEvent;
  const runComplete = String(latestEvent?.event ?? "") === "done";
  const timelinePanel = (
    <Panel icon={Activity} eyebrow="Run path" title="Timeline" dense className="mt-3">
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events loaded.</p>
      ) : (
        <div className="space-y-2">
          <ol className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {events.map((event, index) => {
              const isActive = index === events.length - 1;
              const isPinned = pinnedStep === index;
              const isDone = !isActive || runComplete;
              const message = String(event.message ?? "");
              const timeBits = event.timestamp
                ? ` · ${formatRunTime(event.timestamp)} · ${getAge(event.timestamp)} ago`
                : "";
              const tooltip = `${formatEventTitle(event.event)}${message ? " — " + message : ""}${timeBits}`;
              return (
                <li key={`${String(event.event ?? "")}-${index}`} className="shrink-0 snap-start">
                  <button
                    type="button"
                    ref={isActive ? activePillRef : null}
                    aria-current={isActive ? "step" : undefined}
                    title={tooltip}
                    onClick={() => setPinnedStep(isPinned ? null : index)}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
                      isActive
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : isPinned
                          ? "border-foreground/30 bg-muted/40 text-foreground"
                          : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                        isActive
                          ? "border-foreground/50 bg-background text-foreground"
                          : "border-border/60 bg-background/60 text-muted-foreground",
                      )}
                    >
                      {isDone ? "✓" : index + 1}
                    </span>
                    <span className="capitalize">{formatEventTitle(event.event)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {shownEvent ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11px]">
              <span className="font-semibold capitalize">{formatEventTitle(shownEvent.event)}</span>
              {shownEvent.message ? (
                <span className="text-muted-foreground">{String(shownEvent.message)}</span>
              ) : null}
              {shownEvent.timestamp ? (
                <span className="w-full text-[10px] uppercase tracking-widest text-muted-foreground/80 sm:ml-auto sm:w-auto">
                  {formatRunTime(shownEvent.timestamp)} · {getAge(shownEvent.timestamp)} ago
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );

  return (
    <div
      className={cn(
        "market-lab-surface w-full min-w-0 overflow-x-hidden font-mono",
        embedded ? "px-2 sm:px-3" : "mx-auto max-w-[1500px] px-4 py-6 md:px-6",
      )}
    >
      {/* ── Cockpit ribbon ── */}
      <section className="rounded-lg border border-border/70 bg-card/80">
        <div className="flex flex-col gap-3 px-4 py-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col leading-tight">
              <span className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Market Lab
                {environmentOverview ? (
                  <span
                    className={cn(
                      "rounded border px-1.5 py-px font-bold",
                      environmentOverview.isTestData
                        ? "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    )}
                  >
                    {environmentOverview.current}
                  </span>
                ) : null}
              </span>
              <span className="text-sm font-bold uppercase tracking-wider">Forward-looking trust reviews</span>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 md:flex md:w-auto md:flex-wrap md:items-center">
            <label className="sr-only" htmlFor="market-lab-symbol">
              Symbol
            </label>
            <input
              id="market-lab-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              className="col-span-3 h-8 w-full rounded-md border border-border/70 bg-background px-2 font-mono text-xs font-semibold uppercase tracking-wider outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 md:col-span-1 md:w-24"
              aria-label="Symbol"
            />
            <Button onClick={startRun} disabled={loading} size="sm" className="h-8 w-full justify-center gap-1.5 px-3 font-mono text-xs uppercase tracking-wider md:w-auto">
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              size="sm"
              className="h-8 w-full justify-center gap-1.5 px-3 font-mono text-xs uppercase tracking-wider md:w-auto"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={settleDue}
              disabled={loading}
              size="sm"
              className="h-8 w-full justify-center gap-1.5 px-3 font-mono text-xs uppercase tracking-wider md:w-auto"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Settle due
            </Button>
          </div>
        </div>
      </section>

      {environmentOverview ? (
        <section className="mt-3 grid gap-2 md:grid-cols-2">
          {environmentOverview.environments.map((item) => (
            <div key={item.environment} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-semibold uppercase tracking-wider">{item.environment}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {item.url} · {item.runCount} runs{item.latestRunAt ? ` · latest ${getAge(item.latestRunAt)} ago` : ""}
                </div>
              </div>
              <span
                className={cn(
                  "rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider",
                  item.status === "healthy"
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-300",
                )}
                title={item.message}
              >
                {item.status}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {codexReviewNotice ? <CodexReviewNotice notice={codexReviewNotice} /> : null}

      {/* Debug artifacts — collapsed by default, close to the run controls */}
      <details className="group mt-3 rounded-lg border border-border/70 bg-card/60 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileJson2 className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Collapsed by default</div>
              <div className="text-sm font-semibold">Debug artifacts</div>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground group-open:hidden">Open</span>
          <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground group-open:inline">Close</span>
        </summary>
        <div className="mt-3 space-y-2">
          {ARTIFACT_VIEWERS.map(({ kind, label }) => {
            const artifactPath = review?.artifact_paths?.[kind] ?? null;
            return (
              <ArtifactViewer
                key={kind}
                label={label}
                kind={kind}
                runId={selectedRunId}
                path={artifactPath}
              />
            );
          })}
        </div>
      </details>

      {error ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}
      {settlementStatus ? (
        <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">{settlementStatus}</div>
      ) : null}
      {portfolioStatus ? (
        <div
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-xs",
            portfolioStatus.tone === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
          )}
        >
          {portfolioStatus.message}
        </div>
      ) : null}

      {timelinePanel}

      {/* ── Body: tape + decision area ── */}
      <section className={cn(
        "mt-3 flex flex-col-reverse gap-3",
        showRunTapeSidebar && "lg:grid lg:grid-cols-[180px_minmax(0,1fr)]",
      )}>
        {/* Run tape — always rendered for mobile collapse; hidden on lg+ when strip mode is active */}
        <aside
          className={cn(
            "self-start rounded-lg border border-border/70 bg-card/60",
            showRunTapeSidebar ? "lg:sticky lg:top-3" : "lg:hidden",
          )}
        >
          <button
            type="button"
            onClick={() => setTapeOpen((v) => !v)}
            aria-expanded={tapeOpen}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left lg:hidden"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">History</span>
            <span className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{runs.length}</span>
              <span className={cn("text-xs text-muted-foreground transition-transform", tapeOpen && "rotate-90")}>›</span>
            </span>
          </button>
          <div className={cn("lg:block", tapeOpen ? "block" : "hidden")}>
          <div className="space-y-2 border-b border-border/50 px-3 py-2 lg:border-t-0">
            <div className="hidden items-center justify-between lg:flex">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Run tape</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{runs.length}</span>
            </div>
            <TapeModeTabs mode={tapeMode} onChange={setTapeMode} />
          </div>
          <div className="max-h-[60vh] min-h-0 overflow-y-auto p-1 [scrollbar-gutter:stable] lg:max-h-[min(calc(100svh-180px),720px)]">
            {runs.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No runs yet.</p>
            ) : tapeMode === "recent" ? (
              <ul className="space-y-0.5">
                {runs.map((run) => (
                  <li key={run.run_id}>
                    <RunTapeRow
                      run={run}
                      selected={selectedRunId === run.run_id}
                      onSelect={setSelectedRunId}
                    />
                  </li>
                ))}
              </ul>
            ) : tapeMode === "symbol" ? (
              <div className="space-y-1">
                {runsBySymbol.map(([symbol, groupRuns]) => {
                  const key = `sym:${symbol}`;
                  const hasSelected = groupRuns.some((r) => r.run_id === selectedRunId);
                  const open = !closedGroups.has(key) || hasSelected;
                  const latestVerdict = (groupRuns[0]?.trust_verdict ?? "uncertain") as Verdict;
                  return (
                    <RunTapeGroup
                      key={key}
                      open={open}
                      onToggle={(isOpen) => toggleGroup(key, isOpen)}
                      labelNode={
                        <span className="flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full", verdictMeta[latestVerdict].dot)} />
                          <span className="text-xs font-semibold">{symbol}</span>
                        </span>
                      }
                      count={groupRuns.length}
                    >
                      <ul className="space-y-0.5">
                        {groupRuns.map((run) => (
                          <li key={run.run_id}>
                            <RunTapeRow
                              run={run}
                              selected={selectedRunId === run.run_id}
                              onSelect={setSelectedRunId}
                              hideSymbol
                            />
                          </li>
                        ))}
                      </ul>
                    </RunTapeGroup>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {(["trusted", "uncertain", "blocked"] as const).map((verdictKey) => {
                  const list = runsByVerdict[verdictKey];
                  if (list.length === 0) return null;
                  const key = `verd:${verdictKey}`;
                  const hasSelected = list.some((r) => r.run_id === selectedRunId);
                  const open = !closedGroups.has(key) || hasSelected;
                  return (
                    <RunTapeGroup
                      key={key}
                      open={open}
                      onToggle={(isOpen) => toggleGroup(key, isOpen)}
                      labelNode={
                        <span
                          className={cn(
                            "rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider",
                            verdictMeta[verdictKey].chip,
                          )}
                        >
                          {verdictMeta[verdictKey].label}
                        </span>
                      }
                      count={list.length}
                    >
                      <ul className="space-y-0.5">
                        {list.map((run) => (
                          <li key={run.run_id}>
                            <RunTapeRow
                              run={run}
                              selected={selectedRunId === run.run_id}
                              onSelect={setSelectedRunId}
                              hideVerdictChip
                            />
                          </li>
                        ))}
                      </ul>
                    </RunTapeGroup>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </aside>

        {/* Decision area */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* Horizontal Run Tape strip — only on lg+ when sidebar is hidden */}
          {!showRunTapeSidebar && runs.length > 0 ? (
            <div className="-mx-1 hidden snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 py-1 lg:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {runs.map((run) => {
                const v: Verdict = (run.trust_verdict ?? "uncertain") as Verdict;
                const m = verdictMeta[v];
                const isSelected = selectedRunId === run.run_id;
                return (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => setSelectedRunId(run.run_id)}
                    title={run.run_id}
                    className={cn(
                      "inline-flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                      isSelected
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.dot)} />
                    <span className="font-semibold">{run.symbol}</span>
                    <span className={cn("rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider", m.chip)}>
                      {run.trust_verdict ? m.label : run.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground/80">{getAge(run.requested_at)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {/* Hero: verdict + price ribbon */}
          <section className={cn("overflow-hidden rounded-lg border bg-card/70", meta.ribbon)}>
            <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", meta.chip)}>
                    <VerdictIcon className="h-3 w-3" />
                    {meta.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {formatRunTime(selectedRun?.requested_at)}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {getAge(selectedRun?.requested_at)} ago
                  </span>
                  {selectedRun?.run_id ? (
                    <span className="truncate text-[10px] text-muted-foreground/80">· {selectedRun.run_id}</span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-baseline gap-3">
                  <h2 className="text-3xl font-bold tracking-tight">{selectedSymbol}</h2>
                  <span className={cn("text-xs font-semibold uppercase tracking-widest", meta.accent)}>
                    {meta.label}
                  </span>
                </div>
                <SymbolHistory
                  history={symbolHistory}
                  selectedRunId={selectedRunId}
                  onSelect={setSelectedRunId}
                />
                <p className="mt-2 max-w-2xl font-sans text-sm leading-6 text-foreground/80">
                  {heroSummary}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={settleRun}
                    disabled={!selectedRunId || loading}
                    className="h-7 px-2.5 font-mono text-[11px] uppercase tracking-wider"
                  >
                    Settle
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={askCodex}
                    disabled={!selectedRunId || loading}
                    className="h-7 gap-1.5 px-2.5 font-mono text-[11px] uppercase tracking-wider"
                  >
                    <MessageSquareText className="h-3 w-3" />
                    Ask Codex
                  </Button>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[280px]">
                <PriceCell
                  label={`${selectedSymbol} price`}
                  value={asMoney(review?.price_facts?.price)}
                  detail={priceSource ? `${priceSource}${priceBasis ? ` · ${priceBasis}` : ""}` : "no source"}
                />
                <PriceCell
                  label="SPY reference"
                  value={asMoney(review?.spy_facts?.price)}
                  detail={spySource ?? "no source"}
                />
              </div>
            </div>
          </section>

          {/* Evidence — full width */}
          <Panel icon={CheckCircle2} eyebrow="Trust inputs" title="Evidence board">
            {checks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No checks loaded for this run yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {checks.map((check) => {
                    const sev = severityChip(check.severity, check.code);
                    const code = check.code ?? "check";
                    const isExpanded = expandedCheck === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setExpandedCheck(isExpanded ? null : code)}
                        title={check.message ?? ""}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                          sev.cls,
                          isExpanded && "ring-1 ring-foreground/40",
                        )}
                      >
                        <span className="opacity-70">{sev.label}</span>
                        <span className="font-mono normal-case tracking-normal">{code}</span>
                      </button>
                    );
                  })}
                </div>
                {expandedCheck ? (
                  <div className="mt-2 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 font-sans text-[11px] text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{expandedCheck}</span>
                    {" · "}
                    {checks.find((c) => (c.code ?? "check") === expandedCheck)?.message ?? ""}
                  </div>
                ) : null}
              </>
            )}
            {(() => {
              const bullPoints = review?.interpretation?.bullish_points ?? [];
              const bearPoints = review?.interpretation?.bearish_points ?? [];
              if (!bullPoints.length && !bearPoints.length) return null;
              return (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {bullPoints.length ? (
                    <InsightList title="Bullish" items={bullPoints} empty="" tone="bull" />
                  ) : null}
                  {bearPoints.length ? (
                    <InsightList title="Bearish" items={bearPoints} empty="" tone="bear" />
                  ) : null}
                </div>
              );
            })()}
            {sentiment ? (
              <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3">
                {/* Header */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">News and sentiment</div>
                    <div className="text-xs font-semibold">
                      {sentimentDigest.length} items
                      {sentiment.missing_sources?.length ? ` · missing ${sentiment.missing_sources.join(", ")}` : ""}
                    </div>
                  </div>
                  <span className={cn("rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", statusChipClass(sentiment.status))}>
                    {sentiment.status ?? "unknown"}
                  </span>
                </div>

                {/* Sentiment summary bar */}
                {sentimentDigest.length ? (
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-[11px]">
                    {labeledTotal > 0 ? (
                      <>
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Bull {Math.round((sentimentCounts.bull / labeledTotal) * 100)}%</span>
                          <span className="hidden h-1.5 w-12 rounded-full bg-muted/50 sm:inline-block sm:w-20">
                            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(sentimentCounts.bull / labeledTotal) * 100}%` }} />
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-red-600 dark:text-red-400">Bear {Math.round((sentimentCounts.bear / labeledTotal) * 100)}%</span>
                          <span className="hidden h-1.5 w-12 rounded-full bg-muted/50 sm:inline-block sm:w-20">
                            <span className="block h-full rounded-full bg-red-500" style={{ width: `${(sentimentCounts.bear / labeledTotal) * 100}%` }} />
                          </span>
                        </span>
                      </>
                    ) : null}
                    {sentimentCounts.unlabeled > 0 ? (
                      <span className="text-muted-foreground">+{sentimentCounts.unlabeled} unlabeled</span>
                    ) : null}
                  </div>
                ) : null}

                {/* Codex one-liner */}
                {newsRole ? (
                  <button
                    type="button"
                    onClick={() => setCodexExpanded((v) => !v)}
                    title={newsRole.summary}
                    className="mb-2 flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-left text-[11px] hover:bg-background/80"
                  >
                    <span className={cn("rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", stanceChipClass(newsRole.stance))}>
                      Codex · {newsRole.stance} · {asPercent(newsRole.confidence)}
                    </span>
                    <span className={cn("min-w-0 flex-1 text-muted-foreground", codexExpanded ? "" : "line-clamp-1")}>
                      {newsRole.summary}
                    </span>
                  </button>
                ) : null}

                {/* Filter chips */}
                {sentimentDigest.length ? (
                  <div className="mb-2 -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
                    {[
                      { key: "all", label: "All", count: sentimentDigest.length },
                      ...(sentiment.sources ?? [])
                        .map((s) => ({
                          key: String(s.source ?? ""),
                          label: sourceLabel(s.source),
                          count: sourceCounts[String(s.source ?? "")] ?? 0,
                        }))
                        .filter((opt) => opt.key && opt.count > 0),
                    ].map((opt) => (
                      <button
                        key={`src-${opt.key}`}
                        type="button"
                        onClick={() => setFeedSrc(opt.key)}
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                          feedSrc === opt.key
                            ? "border-foreground/40 bg-foreground/10"
                            : "border-border/60 bg-muted/30 hover:bg-muted/50",
                        )}
                      >
                        <span className={opt.key === "all" ? (feedSrc === opt.key ? "text-foreground" : "text-muted-foreground") : sourceColorClass(opt.key)}>
                          {opt.label}
                        </span>
                        <span className="ml-1 font-normal text-muted-foreground/70">{opt.count}</span>
                      </button>
                    ))}
                    <span className="mx-1 hidden h-3.5 w-px shrink-0 self-center bg-border/60 sm:inline-block" />
                    {(
                      [
                        { key: "all", label: "All", dot: "bg-muted-foreground/60" },
                        { key: "bull", label: "Bull", dot: "bg-emerald-500" },
                        { key: "bear", label: "Bear", dot: "bg-red-500" },
                        { key: "unlabeled", label: "Unlabeled", dot: "bg-muted-foreground/40" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={`sent-${opt.key}`}
                        type="button"
                        onClick={() => setFeedSent(opt.key)}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                          feedSent === opt.key
                            ? "border-foreground/40 bg-foreground/10 text-foreground"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", opt.dot)} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Feed */}
                {sentimentDigest.length === 0 ? (
                  <p className="font-sans text-xs text-muted-foreground">No source summaries available yet.</p>
                ) : filteredFeed.length === 0 ? (
                  <p className="font-sans text-xs text-muted-foreground">No items match these filters.</p>
                ) : (
                  <ul className="max-h-[60vh] overflow-y-auto rounded-md border border-border/50 bg-background/60 sm:max-h-[400px]">
                    {filteredFeed.map((entry, index) => (
                      <li
                        key={`${entry.source}-${index}`}
                        className="flex items-start gap-2 border-b border-border/30 px-2.5 py-2 last:border-b-0"
                      >
                        <span
                          className={cn(
                            "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                            entry.sentiment === "bull"
                              ? "bg-emerald-500"
                              : entry.sentiment === "bear"
                                ? "bg-red-500"
                                : "border border-border/60 bg-transparent",
                          )}
                          title={entry.sentiment ?? "unlabeled"}
                        />
                        <div className="min-w-0 flex-1 font-mono text-[12px] leading-5">
                          <span className={cn("mr-1.5 align-baseline text-[9px] font-semibold uppercase tracking-wider", sourceColorClass(entry.source))}>
                            {sourceLabel(entry.source)}
                          </span>
                          <span className="align-baseline text-foreground">{entry.item}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Panel>

          {/* Compact context row — Memory + Forward Score stack on left, Schwab on right.
              Left col stretches to row height; Forward Score grows so both columns align. */}
          <section className="grid items-stretch gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3 lg:h-full">
              <Panel icon={ShieldCheck} eyebrow="Memory" title="Outcome memory" dense>
                {outcomeMemory ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Metric label="Prior runs" value={String(outcomeMemory.lookback_runs ?? 0)} />
                    <Metric label="Settled" value={String(outcomeMemory.settled_count ?? 0)} />
                    <Metric
                      label="Avg alpha"
                      value={
                        typeof outcomeMemory.evidence_ready_avg_alpha_vs_spy_pct === "number"
                          ? `${outcomeMemory.evidence_ready_avg_alpha_vs_spy_pct.toFixed(2)}%`
                          : "n/a"
                      }
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No outcome memory attached.</p>
                )}
              </Panel>

              <Panel icon={ArrowUpRight} eyebrow="Forward score" title="Settlement" dense className="lg:flex-1">
                <ul className="space-y-1">
                  {settlementWindows.map((settlement) => (
                    <li
                      key={String(settlement.window)}
                      className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                    >
                      <span className="text-xs font-bold uppercase">{String(settlement.window)}</span>
                      <span className="min-w-0 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                        {settlementReturn(settlement) != null
                          ? `${Number(settlementReturn(settlement)).toFixed(2)}% · vs SPY ${
                              settlement.alpha_vs_spy_pct != null
                                ? `${Number(settlement.alpha_vs_spy_pct).toFixed(2)}%`
                                : "—"
                            }`
                          : "pending · vs SPY pending"}
                      </span>
                      <span className="shrink-0 rounded border border-border/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                        {String(settlement.status ?? "pending")}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel icon={ShieldQuestion} eyebrow="Portfolio" title="Schwab portfolio" dense>
              {portfolioContext ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                        portfolioContext.status?.toLowerCase() === "available"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {String(portfolioContext.status ?? "").toUpperCase() || "UNKNOWN"}
                      {usingPortfolioFallback ? " · LATEST CACHE" : ""}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={refreshPortfolio}
                      disabled={loading}
                      title="Refresh Schwab"
                      aria-label="Refresh Schwab"
                      className="h-7 w-7"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Metric label={selectedSymbol} value={selectedPosition ? "owned" : "not owned"} />
                    <Metric label="Quantity" value={asShares(selectedPosition?.quantity)} />
                    <Metric label="Current" value={asMoney(selectedPosition?.current_price ?? undefined)} />
                    <Metric label="Today" value={`${asSignedMoney(selectedPosition?.day_change)} · ${asSignedPercent(selectedPosition?.day_change_pct)}`} />
                    <Metric label="Vs run" value={asSignedPercent(currentVsRun)} />
                    <Metric label="Vs avg" value={asSignedPercent(currentVsAverage)} />
                  </div>
                  {[...(portfolioContext.exposure_notes ?? []), ...(portfolioContext.overlap_notes ?? [])].slice(0, 3).map((note) => (
                    <p key={note} className="font-sans text-xs text-muted-foreground">{note}</p>
                  ))}
                  {usingPortfolioFallback ? (
                    <p className="font-sans text-xs text-muted-foreground">
                      Using latest Schwab cache because this run saved an unavailable portfolio snapshot.
                    </p>
                  ) : portfolioContext.message ? (
                    <p className="font-sans text-xs text-muted-foreground">{portfolioContext.message}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">No portfolio context attached.</p>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={refreshPortfolio}
                    disabled={loading}
                    title="Refresh Schwab"
                    aria-label="Refresh Schwab"
                    className="h-7 w-7"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Panel>
          </section>

          <Panel icon={MessageSquareText} eyebrow="Second opinion" title="Codex review" dense>
            <div className="space-y-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">Status</span>
                <span className="min-w-0 truncate text-right text-xs font-semibold">
                  {codexState}
                  {structuredCodex ? ` · ${asPercent(structuredCodex.confidence)} · ${structuredCodex.horizon.toUpperCase()}` : ""}
                </span>
              </div>
              <p className="font-sans text-xs leading-5 text-muted-foreground">
                {structuredCodex?.summary ?? review?.codex_review?.summary ?? "Use Ask Codex to request an operator-readable critique."}
              </p>
              {review?.codex_review?.session_id ? (
                <div className="truncate text-[10px] text-muted-foreground/80">
                  session: {review.codex_review.session_id}
                </div>
              ) : null}
              {tokenBudget ? (
                <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Token mode</div>
                  <p className="mt-1 font-sans text-xs text-muted-foreground">
                    {String(tokenBudget.mode ?? "quick").toUpperCase()} · {tokenBudget.estimated_input_tokens ?? "?"}/{tokenBudget.max_input_tokens ?? "?"} est. tokens
                  </p>
                </div>
              ) : null}
              {structuredCodex ? (
                <div className="space-y-2 pt-2">
                  <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Context quality</div>
                    <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">{structuredCodex.context_quality}</p>
                    {structuredCodex.missing_context.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {structuredCodex.missing_context.map((item) => (
                          <span key={item} className="rounded border border-border/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-1 lg:grid-cols-2">
                    {structuredCodex.roles.map((role) => (
                      <CodexRoleRow key={role.role} role={role} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>

        </div>
      </section>

    </div>
  );
}

function CodexReviewNotice({ notice }: { notice: CodexReviewNoticeState }) {
  const toneClass =
    notice.tone === "ready"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
      : notice.tone === "missing"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200";
  const Icon = notice.tone === "ready" ? CheckCircle2 : notice.tone === "missing" ? ShieldAlert : MessageSquareText;

  return (
    <div className={cn("mt-3 rounded-lg border px-3 py-2.5 text-xs", toneClass)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold uppercase tracking-wider">{notice.title}</div>
            <div className="mt-0.5 truncate font-sans text-[12px] opacity-85">{notice.message}</div>
          </div>
        </div>
        {notice.sessionId ? (
          <a
            href={`/sessions?sessionId=${encodeURIComponent(notice.sessionId)}`}
            className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline"
          >
            Open session
            <ArrowUpRight className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

type ArtifactKey =
  | "review"
  | "events"
  | "logs"
  | "codex_packet"
  | "codex_review"
  | "evidence_snapshot"
  | "outcome_memory"
  | "portfolio_context";

const ARTIFACT_VIEWERS: Array<{ kind: ArtifactKey; label: string }> = [
  { kind: "review", label: "review.json" },
  { kind: "events", label: "events.jsonl" },
  { kind: "logs", label: "logs.txt" },
  { kind: "codex_packet", label: "codex packet" },
  { kind: "codex_review", label: "codex review" },
  { kind: "evidence_snapshot", label: "evidence snapshot" },
  { kind: "outcome_memory", label: "outcome memory" },
  { kind: "portfolio_context", label: "portfolio context" },
];

function ArtifactViewer({
  label,
  kind,
  runId,
  path,
}: {
  label: string;
  kind: ArtifactKey;
  runId: string | null;
  path: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const disabled = !runId || !path;

  const handleToggle = async (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    if (!nextOpen || contents != null || loading || disabled || !runId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api<{ kind: string; path: string; contents: string; size: number; truncated: boolean }>(
        `/api/market-lab/runs/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(kind)}`,
      );
      setContents(data.contents);
      setMeta({ size: data.size, truncated: data.truncated });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load artifact");
    } finally {
      setLoading(false);
    }
  };

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className={cn(
        "group/file rounded-md border border-border/60 bg-muted/20",
        disabled && "opacity-60",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
          <span className="truncate text-[10px] text-muted-foreground/80">{path ?? "n/a"}</span>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
          {loading ? "loading…" : open ? "close" : disabled ? "—" : "open"}
        </span>
      </summary>
      {open ? (
        <div className="border-t border-border/60 px-2.5 py-2">
          {loadError ? (
            <p className="text-xs text-muted-foreground">{loadError}</p>
          ) : loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : contents != null ? (
            contents.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">(empty file · 0 bytes)</p>
            ) : (
              <>
                {meta?.truncated ? (
                  <p className="mb-1 text-[10px] text-amber-600 dark:text-amber-400">
                    Truncated · file is {meta.size.toLocaleString()} bytes, showing first 512 KB.
                  </p>
                ) : null}
                <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground/85">
                  {contents}
                </pre>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function Panel({
  icon: Icon,
  eyebrow,
  title,
  children,
  dense,
  className,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  dense?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border/70 bg-card/60", className)}>
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
          <div className="text-sm font-semibold">{title}</div>
        </div>
      </header>
      <div className={cn("px-3", dense ? "py-2" : "py-3")}>{children}</div>
    </section>
  );
}

function PriceCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-bold leading-tight">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function TapeModeTabs({ mode, onChange }: { mode: TapeMode; onChange: (mode: TapeMode) => void }) {
  const tabs: Array<{ key: TapeMode; label: string }> = [
    { key: "recent", label: "Recent" },
    { key: "symbol", label: "Symbol" },
    { key: "verdict", label: "Verdict" },
  ];
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
            mode === tab.key
              ? "border-foreground/40 bg-foreground/10 text-foreground"
              : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function RunTapeRow({
  run,
  selected,
  onSelect,
  hideSymbol,
  hideVerdictChip,
}: {
  run: RunSummary;
  selected: boolean;
  onSelect: (runId: string) => void;
  hideSymbol?: boolean;
  hideVerdictChip?: boolean;
}) {
  const runVerdict: Verdict = (run.trust_verdict ?? "uncertain") as Verdict;
  const runMeta = verdictMeta[runVerdict];
  return (
    <button
      type="button"
      onClick={() => onSelect(run.run_id)}
      title={run.run_id}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:bg-muted/50",
        selected && "border-border/70 bg-muted/60",
      )}
    >
      <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", runMeta.dot)} />
      {hideSymbol ? null : <span className="text-xs font-semibold">{run.symbol}</span>}
      {hideVerdictChip ? (
        <span className="text-xs font-semibold">{run.symbol}</span>
      ) : (
        <span className={cn("rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider", runMeta.chip)}>
          {run.trust_verdict ? runMeta.label : run.status}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{getAge(run.requested_at)}</span>
    </button>
  );
}

function RunTapeGroup({
  open,
  onToggle,
  labelNode,
  count,
  children,
}: {
  open: boolean;
  onToggle: (isOpen: boolean) => void;
  labelNode: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group/grp rounded-md"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
        <div className="flex min-w-0 items-center gap-2">
          {labelNode}
          <span className="text-[10px] text-muted-foreground">· {count}</span>
        </div>
        <span className="text-[10px] text-muted-foreground transition group-open/grp:rotate-90">▸</span>
      </summary>
      <div className="mt-0.5 pl-1">{children}</div>
    </details>
  );
}

function SymbolHistory({
  history,
  selectedRunId,
  onSelect,
}: {
  history: RunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  if (history.length <= 1) return null;
  const newest = history[0];
  const oldest = history[history.length - 1];
  const symbol = newest?.symbol ?? "";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">History</span>
      <div className="flex items-center gap-1.5">
        {history.map((run) => {
          const verdict = (run.trust_verdict ?? "uncertain") as Verdict;
          const m = verdictMeta[verdict];
          const isSelected = run.run_id === selectedRunId;
          return (
            <button
              key={run.run_id}
              type="button"
              onClick={() => onSelect(run.run_id)}
              title={`${run.symbol} · ${m.label} · ${getAge(run.requested_at)} ago`}
              className={cn(
                "h-2.5 w-2.5 rounded-full transition",
                m.dot,
                isSelected
                  ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-card"
                  : "opacity-60 hover:opacity-100",
              )}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground/80">
        last {history.length} of {symbol} · {getAge(newest?.requested_at)} → {getAge(oldest?.requested_at)}
      </span>
    </div>
  );
}

function CodexRoleRow({ role }: { role: CodexRoleReview }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{roleLabel(role.role)}</span>
        <span className="rounded border border-border/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
          {role.stance} · {asPercent(role.confidence)}
        </span>
      </div>
      <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">{role.summary}</p>
      {role.missing_evidence.length ? (
        <div className="mt-1 truncate text-[10px] text-muted-foreground/80">
          missing: {role.missing_evidence.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function InsightList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: string[];
  empty: string;
  tone?: "bull" | "bear";
}) {
  const toneStyles =
    tone === "bull"
      ? {
          container: "border-emerald-500/40 bg-emerald-500/[0.06]",
          rail: "border-l-2 border-l-emerald-500 dark:border-l-emerald-400",
          title: "text-emerald-600 dark:text-emerald-400",
          bullet: "▲",
        }
      : tone === "bear"
        ? {
            container: "border-red-500/40 bg-red-500/[0.06]",
            rail: "border-l-2 border-l-red-500 dark:border-l-red-400",
            title: "text-red-600 dark:text-red-400",
            bullet: "▼",
          }
        : {
            container: "border-border/60 bg-muted/20",
            rail: "",
            title: "text-muted-foreground",
            bullet: "·",
          };
  return (
    <div className={cn("rounded-md border px-2.5 py-2", toneStyles.container, toneStyles.rail)}>
      <div className={cn("text-[10px] font-bold uppercase tracking-widest", toneStyles.title)}>{title}</div>
      {items.length === 0 ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 font-mono text-xs">
          {items.map((item) => (
            <li key={item} className="flex gap-1.5 leading-5">
              <span className={cn("shrink-0 text-[10px]", toneStyles.title)}>{toneStyles.bullet}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
