"use client";

import { useEffect, useMemo, useState } from "react";
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

type MarketLabClientProps = {
  embedded?: boolean;
};

type PortfolioNotice = {
  message: string;
  tone: "success" | "warning";
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
  const [settlementStatus, setSettlementStatus] = useState<string | null>(null);
  const [portfolioStatus, setPortfolioStatus] = useState<PortfolioNotice | null>(null);
  const [tapeMode, setTapeMode] = useState<TapeMode>("recent");
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

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

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      await loadRuns();
      await loadLatestPortfolio();
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
  };

  useEffect(() => {
    loadRuns().catch((err: Error) => setError(err.message));
    loadLatestPortfolio().catch(() => {
      setLatestPortfolio(null);
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    loadRunDetail(selectedRunId).catch((err: Error) => setError(err.message));
  }, [selectedRunId]);

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
    setLoading(true);
    setError(null);
    setCodexStatus(null);
    setSettlementStatus(null);
    setPortfolioStatus(null);
    try {
      const result = await api<{ streamId: string; packet_path: string }>(
        `/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/codex-review`,
        { method: "POST" },
      );
      setCodexStatus(`Codex review started in Sessions: ${result.streamId}. It can take a minute; refresh this run after the review attaches.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Codex review");
    } finally {
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
  const tokenBudget = review?.token_budget;
  const outcomeMemory = review?.outcome_memory;
  const portfolioContext = review?.portfolio_context ?? latestPortfolio;
  const usingPortfolioFallback = !review?.portfolio_context && Boolean(latestPortfolio);
  const selectedPosition = portfolioContext?.positions?.find((position) => position.symbol === selectedSymbol) ?? null;
  const currentVsRun = percentMove(selectedPosition?.current_price, review?.price_facts?.price);
  const currentVsAverage = percentMove(selectedPosition?.current_price, selectedPosition?.average_price);
  const sentiment = review?.sentiment_snapshot ?? null;
  const newsRole = structuredCodex?.roles.find((role) => role.role === "news_sentiment") ?? null;
  const sentimentDigest = (sentiment?.sources ?? [])
    .flatMap((source) =>
      sourceSamples(source, 5).map((item) => ({
        source: source.source,
        status: source.status,
        item,
      })),
    )
    .slice(0, 12);
  const latestEvent = events.at(-1);

  return (
    <div
      className={cn(
        "market-lab-surface w-full min-w-0 overflow-x-hidden font-mono",
        embedded ? "" : "mx-auto max-w-[1500px] px-4 py-6 md:px-6",
      )}
    >
      {/* ── Cockpit ribbon ── */}
      <section className="rounded-lg border border-border/70 bg-card/80">
        <div className="flex flex-col gap-3 px-4 py-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Market Lab</span>
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
      {codexStatus ? (
        <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">{codexStatus}</div>
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

      {/* ── Body: tape + decision area ── */}
      <section className="mt-3 grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* Run tape */}
        <aside className="self-start rounded-lg border border-border/70 bg-card/60 xl:sticky xl:top-3">
          <div className="space-y-2 border-b border-border/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Run tape</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{runs.length}</span>
            </div>
            <TapeModeTabs mode={tapeMode} onChange={setTapeMode} />
          </div>
          <div className="max-h-[520px] min-h-0 overflow-y-auto p-1 [scrollbar-gutter:stable] xl:max-h-[min(calc(100svh-180px),720px)]">
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
        </aside>

        {/* Decision area */}
        <div className="flex min-w-0 flex-col gap-3">
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
                  {review?.interpretation?.summary ?? "Select or run a review to see the trust decision."}
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
              <ul className="grid gap-1 lg:grid-cols-2">
                {checks.map((check) => {
                  const sev = severityChip(check.severity, check.code);
                  return (
                    <li
                      key={check.code}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                    >
                      <span className={cn("rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", sev.cls)}>
                        {sev.label}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{check.code ?? "check"}</div>
                        <div className="truncate font-sans text-xs text-muted-foreground">{check.message ?? ""}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <InsightList title="Bullish" items={review?.interpretation?.bullish_points ?? []} empty="No bullish points." />
              <InsightList title="Bearish" items={review?.interpretation?.bearish_points ?? []} empty="No bearish points." />
            </div>
            {sentiment ? (
              <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">News and sentiment</div>
                    <div className="text-xs font-semibold">
                      Sources checked
                      {sentiment.missing_sources?.length ? ` · missing ${sentiment.missing_sources.join(", ")}` : ""}
                    </div>
                  </div>
                  <span className={cn("rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", statusChipClass(sentiment.status))}>
                    {sentiment.status ?? "unknown"}
                  </span>
                </div>
                <div className="mb-2 grid gap-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2.5">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">News analysis</div>
                      {newsRole ? (
                        <span className={cn("rounded border px-1.5 py-px text-[9px] uppercase tracking-wider", statusChipClass(newsRole.stance))}>
                          {newsRole.stance} · {asPercent(newsRole.confidence)}
                        </span>
                      ) : null}
                    </div>
                    {newsRole ? (
                      <div className="space-y-2">
                        <p className="font-sans text-sm leading-6 text-muted-foreground">{newsRole.summary}</p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <InsightList title="Positive signals" items={newsRole.bull_points} empty="No positive news signals." />
                          <InsightList title="Cautions" items={[...newsRole.bear_points, ...newsRole.missing_evidence.map((item) => `Missing: ${item}`)]} empty="No news cautions." />
                        </div>
                      </div>
                    ) : (
                      <p className="font-sans text-sm leading-6 text-muted-foreground">
                        No Codex news role attached yet. Showing fetched source samples from Yahoo, StockTwits, and Reddit.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2.5">
                    <div className="mb-2 text-sm font-semibold">Fetched news and posts</div>
                    {sentimentDigest.length ? (
                      <ul className="grid gap-1.5 md:grid-cols-2">
                        {sentimentDigest.map((item, index) => (
                          <li key={`${item.source}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-border/50 bg-muted/20 px-2.5 py-2 font-sans text-xs leading-5 text-muted-foreground">
                            <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full", item.status === "available" ? "bg-emerald-500" : "bg-amber-500")} />
                            <span>
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{sourceLabel(item.source)}</span>
                              {" · "}
                              {item.item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="font-sans text-xs text-muted-foreground">No source summaries available yet.</p>
                    )}
                  </div>
                </div>
                <ul className="grid gap-2 lg:grid-cols-3">
                  {(sentiment.sources ?? []).map((source) => (
                    <li key={source.source} className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold">{sourceLabel(source.source)}</span>
                        <span className={cn("rounded border px-1.5 py-px text-[9px] uppercase tracking-wider", statusChipClass(source.status))}>
                          {source.status ?? "n/a"}
                        </span>
                      </div>
                      <div className="mt-1 font-sans text-[11px] text-muted-foreground">
                        {source.sample_count ?? 0} samples · {source.fetch_method ?? "source adapter"}
                      </div>
                      {sourceSamples(source, 3).length ? (
                        <ul className="mt-1.5 space-y-1 font-sans text-[11px] leading-4 text-muted-foreground">
                          {sourceSamples(source, 3).map((sample, index) => (
                            <li key={`${source.source}-sample-${index}`} className="line-clamp-2">
                              {sample}
                            </li>
                          ))}
                        </ul>
                      ) : source.error_message ? (
                        <p className="mt-1 line-clamp-3 font-sans text-[11px] leading-4 text-muted-foreground">{source.error_message}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          {/* Compact context row */}
          <section className="grid gap-3 xl:grid-cols-3">
            <Panel icon={ShieldCheck} eyebrow="Memory" title="Outcome memory" dense className="h-full">
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

            <Panel icon={ShieldQuestion} eyebrow="Portfolio" title="Schwab portfolio" dense className="h-full">
              <div className="mb-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshPortfolio}
                  disabled={loading}
                  className="h-7 gap-1.5 px-2.5 font-mono text-[11px] uppercase tracking-wider"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh Schwab
                </Button>
              </div>
              {portfolioContext ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{portfolioContext.status}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {portfolioContext.source}{usingPortfolioFallback ? " · latest cache" : ""}
                    </span>
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
                  {portfolioContext.message ? <p className="font-sans text-xs text-muted-foreground">{portfolioContext.message}</p> : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No portfolio context attached.</p>
              )}
            </Panel>

            <Panel icon={ArrowUpRight} eyebrow="Forward score" title="Settlement" dense className="h-full">
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

          {/* Timeline — full width, events flow as a horizontal grid */}
          <Panel icon={Activity} eyebrow="Run path" title="Timeline" dense className="flex-1">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events loaded.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span className="text-xs font-semibold">Current: {formatEventTitle(latestEvent?.event)}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    step {events.length} of {events.length}
                    {latestEvent?.timestamp ? ` · ${formatRunTime(latestEvent.timestamp)} · ${getAge(latestEvent.timestamp)} ago` : ""}
                  </span>
                </div>
                <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {events.map((event, index) => (
                    <li
                      key={`${String(event.event ?? "")}-${index}`}
                      className={cn(
                        "grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2 rounded-md border px-2.5 py-1.5",
                        index === events.length - 1 ? "border-foreground/30 bg-foreground/[0.03]" : "border-border/60 bg-muted/20",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                          index === events.length - 1
                            ? "border-foreground/40 bg-background text-foreground"
                            : "border-border/60 bg-background/60 text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{formatEventTitle(event.event)}</div>
                        <div className="truncate font-sans text-[11px] text-muted-foreground">{String(event.message ?? "")}</div>
                        {event.timestamp ? (
                          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/80">
                            {formatRunTime(event.timestamp)} · {getAge(event.timestamp)} ago
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Panel>
        </div>
      </section>

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
    <div className="grid grid-cols-3 gap-px rounded-md border border-border/50 bg-muted/20 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest transition",
            mode === tab.key
              ? "bg-background font-bold text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
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
      className={cn(
        "group w-full rounded-md border border-transparent px-2 py-1.5 text-left transition hover:bg-muted/50",
        selected && "border-border/70 bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", runMeta.dot)} />
          {hideSymbol ? null : <span className="text-xs font-semibold">{run.symbol}</span>}
          {hideVerdictChip ? (
            <span className="text-xs font-semibold">{run.symbol}</span>
          ) : (
            <span className={cn("rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider", runMeta.chip)}>
              {run.trust_verdict ?? run.status}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{getAge(run.requested_at)}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{run.run_id}</div>
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

function InsightList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="mt-1 font-sans text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 font-sans text-xs">
          {items.map((item) => (
            <li key={item} className="leading-5">
              · {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
