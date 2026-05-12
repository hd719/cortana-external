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
  return_pct?: number;
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
      output_path?: string | null;
      session_id?: string | null;
    } | null;
    artifact_paths?: {
      review?: string;
      events?: string;
      logs?: string;
      codex_packet?: string | null;
      codex_review?: string | null;
    };
    checks?: Array<{ code?: string; severity?: string; message?: string }>;
    settlements?: Settlement[];
  } | null;
  settlements: Settlement[];
};

type Verdict = "trusted" | "uncertain" | "blocked";

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
    label: "Trusted",
    code: "OK",
    icon: ShieldCheck,
    dot: "bg-emerald-500 dark:bg-emerald-400",
    accent: "text-emerald-600 dark:text-emerald-400",
    rail: "border-l-emerald-500 dark:border-l-emerald-400",
    chip: "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ribbon: "border-emerald-500/40 bg-emerald-500/[0.04]",
  },
  uncertain: {
    label: "Uncertain",
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

export function MarketLabClient({ embedded = false }: MarketLabClientProps = {}) {
  const [symbol, setSymbol] = useState("AAPL");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const loadRuns = async () => {
    const data = await api<{ runs: RunSummary[] }>("/api/market-lab/runs?limit=25");
    setRuns(data.runs);
    setSelectedRunId((current) => current ?? data.runs[0]?.run_id ?? null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await loadRuns();
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
      api<Array<Record<string, unknown>>>(`/api/market-lab/runs/${encodeURIComponent(runId)}/events`),
    ]);
    setDetail(runDetail);
    setEvents(eventItems);
  };

  useEffect(() => {
    loadRuns().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    loadRunDetail(selectedRunId).catch((err: Error) => setError(err.message));
  }, [selectedRunId]);

  const startRun = async () => {
    setLoading(true);
    setError(null);
    setCodexStatus(null);
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
    try {
      await api(`/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/settle`, { method: "POST" });
      await loadRunDetail(selectedRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle run");
    } finally {
      setLoading(false);
    }
  };

  const askCodex = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    setCodexStatus(null);
    try {
      const result = await api<{ streamId: string; packet_path: string }>(
        `/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/codex-review`,
        { method: "POST" },
      );
      setCodexStatus(`Codex review started: ${result.streamId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Codex review");
    } finally {
      setLoading(false);
    }
  };

  const review = detail?.review;
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
  const codexState = review?.codex_review?.verdict ?? review?.codex_review?.status ?? "not requested";

  return (
    <div
      className={cn(
        "market-lab-surface w-full font-mono",
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="market-lab-symbol">
              Symbol
            </label>
            <input
              id="market-lab-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              className="h-8 w-24 rounded-md border border-border/70 bg-background px-2 font-mono text-xs font-semibold uppercase tracking-wider outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
              aria-label="Symbol"
            />
            <Button onClick={startRun} disabled={loading} size="sm" className="h-8 gap-1.5 px-3 font-mono text-xs uppercase tracking-wider">
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              size="sm"
              className="h-8 gap-1.5 px-3 font-mono text-xs uppercase tracking-wider"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}
      {codexStatus ? (
        <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">{codexStatus}</div>
      ) : null}

      {/* ── Body: tape + decision area ── */}
      <section className="mt-3 grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* Run tape */}
        <aside className="self-start rounded-lg border border-border/70 bg-card/60 xl:sticky xl:top-3">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Run tape</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{runs.length}</span>
          </div>
          <div className="max-h-[520px] min-h-0 overflow-y-auto p-1 xl:max-h-[calc(100svh-180px)]">
            {runs.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No runs yet.</p>
            ) : null}
            <ul className="space-y-0.5">
              {runs.map((run) => {
                const runVerdict: Verdict = (run.trust_verdict ?? "uncertain") as Verdict;
                const runMeta = verdictMeta[runVerdict];
                const selected = selectedRunId === run.run_id;
                return (
                  <li key={run.run_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedRunId(run.run_id)}
                      className={cn(
                        "group w-full rounded-md border border-transparent px-2 py-1.5 text-left transition hover:bg-muted/50",
                        selected && "border-border/70 bg-muted/60",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", runMeta.dot)} />
                          <span className="text-xs font-semibold">{run.symbol}</span>
                          <span className={cn("rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider", runMeta.chip)}>
                            {run.trust_verdict ?? run.status}
                          </span>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{getAge(run.requested_at)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{run.run_id}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Decision area */}
        <div className="min-w-0 space-y-3">
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
                    verdict {verdict}
                  </span>
                </div>
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
          </Panel>

          {/* Codex + Settlement — paired row, h-full so bottoms align */}
          <section className="grid gap-3 lg:grid-cols-2">
            <Panel icon={MessageSquareText} eyebrow="Second opinion" title="Codex review" dense className="h-full">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</span>
                  <span className="text-xs font-semibold">{codexState}</span>
                </div>
                <p className="font-sans text-xs leading-5 text-muted-foreground">
                  {review?.codex_review?.summary ?? "Use Ask Codex to request an operator-readable critique."}
                </p>
                {review?.codex_review?.session_id ? (
                  <div className="truncate text-[10px] text-muted-foreground/80">
                    session: {review.codex_review.session_id}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel icon={ArrowUpRight} eyebrow="Forward score" title="Settlement" dense className="h-full">
              <ul className="space-y-1">
                {settlementWindows.map((settlement) => (
                  <li
                    key={String(settlement.window)}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                  >
                    <span className="text-xs font-bold uppercase">{String(settlement.window)}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {settlement.return_pct != null
                        ? `${Number(settlement.return_pct).toFixed(2)}% · vs SPY ${
                            settlement.alpha_vs_spy_pct != null
                              ? `${Number(settlement.alpha_vs_spy_pct).toFixed(2)}%`
                              : "—"
                          }`
                        : "Return: pending · vs SPY: pending"}
                    </span>
                    <span className="rounded border border-border/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                      {String(settlement.status ?? "pending")}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>

          {/* Timeline — full width, events flow as a horizontal grid */}
          <Panel icon={Activity} eyebrow="Run path" title="Timeline" dense>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events loaded.</p>
            ) : (
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {events.map((event, index) => (
                  <li
                    key={`${String(event.event ?? "")}-${index}`}
                    className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                  >
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground/70" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{String(event.event ?? "event")}</div>
                      <div className="truncate font-sans text-[11px] text-muted-foreground">{String(event.message ?? "")}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <details className="group rounded-lg border border-border/70 bg-card/60 px-4 py-3">
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
            <div className="mt-3 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
              <DebugPath label="review" value={review?.artifact_paths?.review ?? selectedRun?.run_id ?? "n/a"} />
              <DebugPath label="events" value={review?.artifact_paths?.events ?? "n/a"} />
              <DebugPath label="logs" value={review?.artifact_paths?.logs ?? "n/a"} />
              <DebugPath label="codex packet" value={review?.artifact_paths?.codex_packet ?? "n/a"} />
              <DebugPath label="codex review" value={review?.artifact_paths?.codex_review ?? "n/a"} />
            </div>
          </details>
        </div>
      </section>
    </div>
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
    <section className={cn("rounded-lg border border-border/70 bg-card/60", className)}>
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

function DebugPath({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="truncate rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
      {label}: {value ?? "n/a"}
    </div>
  );
}
